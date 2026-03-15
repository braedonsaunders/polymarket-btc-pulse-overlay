// BTC Pulse Overlay - read-only Binance market context for compatible Polymarket pages.
(function () {
  "use strict";

  const EXTENSION_NAME = "BTC Pulse Overlay";
  const RECONNECT_BASE_MS = 500;
  const RECONNECT_MAX_MS = 10000;
  const STALE_AFTER_MS = 3000;
  const POLL_INTERVAL_MS = 400;
  const PANEL_RENDER_INTERVAL_MS = 120;
  const FLOW_RETENTION_MS = 12000;
  const PRIMARY_FLOW_WINDOW_MS = 3000;
  const MAX_FLOW_SATURATION_USD = 3000000;
  const ASSET_CONFIGS = [
    {
      key: "btc",
      pairLabel: "Binance BTC/USDT",
      streamSymbol: "btcusdt",
      isSupported: true,
      patterns: [/\bbitcoin\b/i, /(?:^|[^a-z])btc(?:[^a-z]|$)/i],
    },
    {
      key: "eth",
      pairLabel: "Binance ETH/USDT",
      streamSymbol: "ethusdt",
      isSupported: true,
      patterns: [/\bethereum\b/i, /\betherium\b/i, /(?:^|[^a-z])eth(?:[^a-z]|$)/i],
    },
    {
      key: "sol",
      pairLabel: "Binance SOL/USDT",
      streamSymbol: "solusdt",
      isSupported: true,
      patterns: [/\bsolana\b/i, /(?:^|[^a-z])sol(?:[^a-z]|$)/i],
    },
    {
      key: "xrp",
      pairLabel: "Binance XRP/USDT",
      streamSymbol: "xrpusdt",
      isSupported: true,
      patterns: [/\bripple\b/i, /(?:^|[^a-z])xrp(?:[^a-z]|$)/i],
    },
    {
      key: "doge",
      pairLabel: "Binance DOGE/USDT",
      streamSymbol: "dogeusdt",
      isSupported: true,
      patterns: [/\bdogecoin\b/i, /(?:^|[^a-z])doge(?:[^a-z]|$)/i],
    },
    {
      key: "bnb",
      pairLabel: "Binance BNB/USDT",
      streamSymbol: "bnbusdt",
      isSupported: true,
      patterns: [/\bbinance coin\b/i, /(?:^|[^a-z])bnb(?:[^a-z]|$)/i],
    },
  ];
  const DEFAULT_ASSET = ASSET_CONFIGS[0];

  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_BASE_MS;
  let activeAsset = DEFAULT_ASSET;
  let flashTimeout = null;
  let lastPrice = null;
  let prevPrice = null;
  let lastMessageTs = 0;
  let latencyMs = 0;
  let lastPanelRenderTs = 0;

  let bestBidPrice = null;
  let bestBidQty = null;
  let bestAskPrice = null;
  let bestAskQty = null;
  let lastMidPrice = null;
  let spreadBps = 0;
  let bookImbalance = 0;

  const aggFlow = [];

  let latestFlow = {
    score: 0,
    tone: "neutral",
    label: "Warming",
    meta: "Waiting for live flow",
  };
  let latestLiquidity = {
    score: 0,
    tone: "mid",
    label: "Loading",
    meta: "Waiting for book",
  };

  let injectedCol = null;
  let injectedDivider = null;
  let elPrice = null;
  let elPairLabel = null;
  let elLatency = null;
  let elDot = null;
  let elFlowChip = null;
  let elFlowMeta = null;
  let elFlowFill = null;
  let elLiquidityChip = null;
  let elLiquidityMeta = null;

  const style = document.createElement("style");
  style.textContent = `
    :root {
      --bpo-accent: #0ea5e9;
      --bpo-accent-strong: #0284c7;
      --bpo-buy: #16a34a;
      --bpo-sell: #f97316;
      --bpo-ink: #e2e8f0;
      --bpo-muted: #94a3b8;
      --bpo-surface: #0f172a;
      --bpo-line: rgba(148, 163, 184, 0.22);
    }
    .bpo-price-value {
      display: block;
      width: 100%;
      margin-top: 4px;
      text-align: right;
      font-size: 24px;
      font-weight: 620;
      line-height: 1.2;
      letter-spacing: 0.025em;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      transition: color 0.15s;
    }
    .bpo-tick-up { color: var(--bpo-buy) !important; }
    .bpo-tick-down { color: #ef4444 !important; }
    .bpo-label-row {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
      width: 100%;
      min-width: 0;
    }
    .bpo-label-main {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .bpo-root {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      width: 100%;
      min-width: 0;
    }
    .bpo-price-block {
      display: flex;
      flex: 0 0 118px;
      flex-direction: column;
      align-items: flex-end;
      padding-top: 1px;
    }
    .bpo-divider-anchor {
      order: 9998;
      margin-left: 10px;
      flex-shrink: 0;
    }
    .bpo-col-anchor {
      order: 9999;
      width: 330px;
      min-width: 330px;
      flex-shrink: 0;
    }
    .bpo-dot {
      width: 6px;
      height: 6px;
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--bpo-accent);
      box-shadow: 0 0 4px rgba(14, 165, 233, 0.45);
      transition: background 0.3s, box-shadow 0.3s;
    }
    .bpo-dot.disconnected {
      background: #ef4444;
      box-shadow: 0 0 4px rgba(239, 68, 68, 0.45);
    }
    .bpo-dot.stale {
      background: #f59e0b;
      box-shadow: 0 0 4px rgba(245, 158, 11, 0.45);
    }
    .bpo-latency {
      margin-left: 2px;
      font-size: 10px;
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
    }
    .bpo-latency.fast { color: var(--bpo-buy); }
    .bpo-latency.ok { color: #f59e0b; }
    .bpo-latency.slow { color: #ef4444; }
    .bpo-status-block {
      display: flex;
      flex: 0 0 194px;
      min-width: 194px;
      box-sizing: border-box;
      flex-direction: column;
      gap: 3px;
      padding-left: 6px;
      border-left: 1px solid var(--bpo-line);
    }
    .bpo-status-row {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .bpo-status-label {
      width: 24px;
      flex-shrink: 0;
      color: var(--bpo-muted);
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .bpo-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 16px;
      padding: 0 6px;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .bpo-chip.neutral {
      color: #cbd5e1;
      background: #334155;
    }
    .bpo-chip.buy {
      color: #ecfdf5;
      background: #15803d;
    }
    .bpo-chip.sell {
      color: #fff7ed;
      background: #ea580c;
    }
    .bpo-chip.low {
      color: #fff7ed;
      background: #9a3412;
    }
    .bpo-chip.mid {
      color: #dbeafe;
      background: #1d4ed8;
    }
    .bpo-chip.high {
      color: #ecfdf5;
      background: #047857;
    }
    .bpo-meta {
      max-width: 126px;
      overflow: hidden;
      color: var(--bpo-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 9px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .bpo-meter {
      width: 100%;
      height: 2px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.18);
    }
    .bpo-meter-fill {
      width: 0%;
      height: 100%;
      border-radius: inherit;
      transition: width 0.12s ease, background 0.12s ease;
      background: #64748b;
    }
    .bpo-meter-fill.neutral { background: #64748b; }
    .bpo-meter-fill.buy { background: #16a34a; }
    .bpo-meter-fill.sell { background: #f97316; }
  `;
  document.head.appendChild(style);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatPrice(value) {
    const n = parseFloat(value);
    if (isNaN(n)) return "--";
    return n >= 100000
      ? "$" + Math.round(n).toLocaleString("en-US")
      : "$" + n.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  }

  function formatCompactUsd(value) {
    if (!isFinite(value)) return "--";
    const abs = Math.abs(value);
    if (abs >= 1000000000) return "$" + (abs / 1000000000).toFixed(2) + "B";
    if (abs >= 1000000) return "$" + (abs / 1000000).toFixed(2) + "M";
    if (abs >= 1000) return "$" + (abs / 1000).toFixed(1) + "K";
    return "$" + abs.toFixed(0);
  }

  function formatBps(value) {
    if (!isFinite(value)) return "--";
    return value.toFixed(2) + "bp";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getPageSlug() {
    return location.pathname.split("/").filter(Boolean).pop() || "";
  }

  function getPageHeadingText() {
    return normalizeText(document.querySelector("h1")?.textContent || "");
  }

  function findSupportedAssetInText(text) {
    const source = String(text || "");
    if (!source) return null;

    let bestMatch = null;

    for (const asset of ASSET_CONFIGS) {
      for (const pattern of asset.patterns) {
        const match = source.match(pattern);
        if (!match) continue;

        const index = typeof match.index === "number" ? match.index : 0;
        if (!bestMatch || index < bestMatch.index) {
          bestMatch = { asset, index };
        }
      }
    }

    return bestMatch?.asset || null;
  }

  function toAssetKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function formatAssetLabel(value) {
    return String(value || "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function getFiveMinuteMarketAssetName() {
    const headingText = getPageHeadingText();
    const headingMatch = headingText.match(/^(.+?)\s+Up or Down\s*-\s*5\s*min\b/i);
    if (headingMatch?.[1]) return formatAssetLabel(headingMatch[1]);

    const slug = getPageSlug();
    const slugMatch = slug.match(/^(.+?)-up-or-down-5-min(?:-|$)/i);
    if (slugMatch?.[1]) return formatAssetLabel(slugMatch[1]);

    return "";
  }

  function createUnsupportedAsset(assetName) {
    const label = formatAssetLabel(assetName) || "Asset";
    const key = toAssetKey(label) || "asset";

    return {
      key: "unsupported:" + key,
      pairLabel: "Binance " + label + " unavailable",
      streamSymbol: "",
      isSupported: false,
      patterns: [],
    };
  }

  function detectTrackedAsset() {
    const supportedAsset =
      findSupportedAssetInText(getPageSlug()) || findSupportedAssetInText(getPageHeadingText());
    if (supportedAsset) return supportedAsset;

    const marketAssetName = getFiveMinuteMarketAssetName();
    if (marketAssetName) {
      return createUnsupportedAsset(marketAssetName);
    }

    return DEFAULT_ASSET;
  }

  function buildWsUrl(streamSymbol) {
    return (
      "wss://stream.binance.com:9443/stream?streams=" +
      streamSymbol +
      "@trade/" +
      streamSymbol +
      "@aggTrade/" +
      streamSymbol +
      "@bookTicker"
    );
  }

  function isElementVisible(element) {
    if (!element || !document.body.contains(element)) return false;

    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.display === "none" || computedStyle.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findVisibleExactText(text) {
    const target = normalizeText(text);
    const elements = document.querySelectorAll("span, div, p, button");
    for (const element of elements) {
      if (!isElementVisible(element)) continue;
      if (normalizeText(element.textContent) === target) return element;
    }
    return null;
  }

  function findPriceContext() {
    let fallback = null;
    const label = findVisibleExactText("Price to beat");
    if (!label) return null;

    const col = label.closest("div.flex.flex-col") || label.parentElement?.parentElement;
    const row = col?.parentElement || null;
    if (!row || !row.classList.contains("flex")) return null;

    const context = { row, col };
    if (!fallback) fallback = context;
    if (isElementVisible(row) && isElementVisible(col)) return context;
    return fallback;
  }

  function resetInjectedRefs() {
    injectedCol = null;
    injectedDivider = null;
    elPrice = null;
    elPairLabel = null;
    elLatency = null;
    elDot = null;
    elFlowChip = null;
    elFlowMeta = null;
    elFlowFill = null;
    elLiquidityChip = null;
    elLiquidityMeta = null;
  }

  function cleanupInjectedNodes(activeRow) {
    const nodes = document.querySelectorAll("[data-bpo='1']");
    for (const node of nodes) {
      if (activeRow && activeRow.contains(node)) continue;
      node.remove();
    }
  }

  function renderPairLabel() {
    if (!elPairLabel) return;
    elPairLabel.textContent = activeAsset.pairLabel;
  }

  function renderFlow() {
    if (!elFlowChip || !elFlowMeta || !elFlowFill) return;

    const tone = latestFlow.tone || "neutral";
    elFlowChip.textContent = latestFlow.label || "Warming";
    elFlowChip.className = "bpo-chip " + tone;
    elFlowMeta.textContent = latestFlow.meta || "Waiting for live flow";
    elFlowMeta.title = latestFlow.meta || "Waiting for live flow";
    elFlowFill.className = "bpo-meter-fill " + tone;
    elFlowFill.style.width = clamp(latestFlow.score || 0, 0, 100) + "%";
  }

  function renderLiquidity() {
    if (!elLiquidityChip || !elLiquidityMeta) return;

    const tone = latestLiquidity.tone || "mid";
    elLiquidityChip.textContent = latestLiquidity.label || "Loading";
    elLiquidityChip.className = "bpo-chip " + tone;
    elLiquidityMeta.textContent = latestLiquidity.meta || "Waiting for book";
    elLiquidityMeta.title = latestLiquidity.meta || "Waiting for book";
  }

  function updateLatency() {
    if (!elLatency) return;

    const latency = Math.max(0, latencyMs);
    elLatency.textContent = latency + "ms";
    elLatency.className =
      "bpo-latency " + (latency < 200 ? "fast" : latency < 500 ? "ok" : "slow");
  }

  function stabilizeAnchorColumn(anchorCol) {
    if (!anchorCol || anchorCol.getAttribute("data-bpo-col") === "1") return;

    const currentMinWidth = parseFloat(anchorCol.dataset.bpoAnchorMinWidth || "0") || 0;
    if (currentMinWidth > 0) {
      anchorCol.style.minWidth = currentMinWidth + "px";
      anchorCol.style.flexShrink = "0";
      return;
    }

    const measuredWidth = Math.ceil(anchorCol.getBoundingClientRect().width);
    if (!measuredWidth) return;

    const appliedMinWidth = measuredWidth + 12;
    anchorCol.dataset.bpoAnchorMinWidth = String(appliedMinWidth);
    anchorCol.style.minWidth = appliedMinWidth + "px";
    anchorCol.style.flexShrink = "0";
  }

  function ensureRightmostPlacement(row) {
    if (!row) return;

    if (injectedDivider && injectedDivider.parentElement === row) {
      injectedDivider.classList.add("bpo-divider-anchor");
      row.appendChild(injectedDivider);
    }

    if (injectedCol && injectedCol.parentElement === row) {
      injectedCol.classList.add("bpo-col-anchor");
      row.appendChild(injectedCol);
    }
  }

  function resetLiveStreamState() {
    clearTimeout(flashTimeout);
    flashTimeout = null;

    lastPrice = null;
    prevPrice = null;
    lastMessageTs = 0;
    latencyMs = 0;
    lastPanelRenderTs = 0;

    bestBidPrice = null;
    bestBidQty = null;
    bestAskPrice = null;
    bestAskQty = null;
    lastMidPrice = null;
    spreadBps = 0;
    bookImbalance = 0;

    aggFlow.length = 0;

    latestFlow = {
      score: 0,
      tone: "neutral",
      label: "Warming",
      meta: "Waiting for live flow",
    };
    latestLiquidity = {
      score: 0,
      tone: "mid",
      label: "Loading",
      meta: "Waiting for book",
    };

    if (elPrice) {
      elPrice.textContent = "--";
      elPrice.classList.remove("bpo-tick-up", "bpo-tick-down");
    }
    if (elLatency) {
      elLatency.textContent = "--";
      elLatency.className = "bpo-latency";
    }
    if (elDot) elDot.className = "bpo-dot disconnected";

    renderFlow();
    renderLiquidity();
  }

  function disconnectSocket() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    if (!ws) return;

    const socket = ws;
    ws = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    try {
      socket.close();
    } catch (error) {
      console.warn("[" + EXTENSION_NAME + "] WS close error", error);
    }
  }

  function syncTrackedAsset(forceReconnect = false) {
    const nextAsset = detectTrackedAsset();
    if (!forceReconnect && activeAsset.key === nextAsset.key) {
      renderPairLabel();
      return false;
    }

    activeAsset = nextAsset;
    reconnectDelay = RECONNECT_BASE_MS;
    resetLiveStreamState();
    renderPairLabel();
    disconnectSocket();
    connect();
    return true;
  }

  function injectColumn(context) {
    context = context || findPriceContext();
    const row = context?.row || null;
    const anchorCol = context?.col || null;
    if (!row) return false;

    stabilizeAnchorColumn(anchorCol);

    const existingPrice = row.querySelector("[data-bpo-price]");
    if (existingPrice) {
      injectedCol = row.querySelector("[data-bpo-col]") || existingPrice.closest("[data-bpo]");
      injectedDivider =
        row.querySelector("[data-bpo-divider]") ||
        (injectedCol?.previousElementSibling?.getAttribute("data-bpo") === "1"
          ? injectedCol.previousElementSibling
          : null);

      if (injectedCol) {
        injectedCol.setAttribute("data-bpo", "1");
        injectedCol.setAttribute("data-bpo-col", "1");
        injectedCol.classList.add("bpo-col-anchor");
      }
      if (injectedDivider) {
        injectedDivider.setAttribute("data-bpo", "1");
        injectedDivider.setAttribute("data-bpo-divider", "1");
        injectedDivider.classList.add("bpo-divider-anchor");
      }

      elPrice = existingPrice;
      elPairLabel = row.querySelector("[data-bpo-pair-label]");
      elLatency = row.querySelector("[data-bpo-latency]");
      elDot = row.querySelector("[data-bpo-dot]");
      elFlowChip = row.querySelector("[data-bpo-flow-chip]");
      elFlowMeta = row.querySelector("[data-bpo-flow-meta]");
      elFlowFill = row.querySelector("[data-bpo-flow-fill]");
      elLiquidityChip = row.querySelector("[data-bpo-liquidity-chip]");
      elLiquidityMeta = row.querySelector("[data-bpo-liquidity-meta]");

      if (lastPrice) {
        elPrice.textContent = formatPrice(lastPrice);
        updateLatency();
      }

      renderPairLabel();
      renderFlow();
      renderLiquidity();

      if (elDot) {
        elDot.className =
          ws && ws.readyState === WebSocket.OPEN ? "bpo-dot" : "bpo-dot disconnected";
      }

      ensureRightmostPlacement(row);
      return true;
    }

    injectedDivider = document.createElement("div");
    injectedDivider.className =
      "w-px h-8 border-r my-auto mx-2 sm:mx-3 lg:mx-5 bpo-divider-anchor";
    injectedDivider.setAttribute("data-bpo", "1");
    injectedDivider.setAttribute("data-bpo-divider", "1");

    injectedCol = document.createElement("div");
    injectedCol.className = "flex flex-col bpo-col-anchor";
    injectedCol.setAttribute("data-bpo", "1");
    injectedCol.setAttribute("data-bpo-col", "1");
    injectedCol.style.opacity = "1";
    injectedCol.innerHTML = `
      <div class="bpo-label-row">
        <div class="bpo-label-main">
          <div class="bpo-dot" data-bpo-dot></div>
          <span class="text-body-xs font-semibold" data-bpo-pair-label style="color: var(--bpo-accent);">Binance live</span>
          <span class="bpo-latency" data-bpo-latency>--</span>
        </div>
      </div>
      <div class="bpo-root">
        <div class="bpo-price-block">
          <span class="bpo-price-value" data-bpo-price style="color: var(--bpo-accent);">--</span>
        </div>
        <div class="bpo-status-block">
          <div class="bpo-status-row">
            <span class="bpo-status-label">Flow</span>
            <span class="bpo-chip neutral" data-bpo-flow-chip>Warming</span>
            <span class="bpo-meta" data-bpo-flow-meta>Waiting for live flow</span>
          </div>
          <div class="bpo-meter">
            <div class="bpo-meter-fill neutral" data-bpo-flow-fill></div>
          </div>
          <div class="bpo-status-row">
            <span class="bpo-status-label">Liq</span>
            <span class="bpo-chip mid" data-bpo-liquidity-chip>Loading</span>
            <span class="bpo-meta" data-bpo-liquidity-meta>Waiting for book</span>
          </div>
        </div>
      </div>
    `;

    row.appendChild(injectedDivider);
    row.appendChild(injectedCol);
    ensureRightmostPlacement(row);

    elPrice = injectedCol.querySelector("[data-bpo-price]");
    elPairLabel = injectedCol.querySelector("[data-bpo-pair-label]");
    elLatency = injectedCol.querySelector("[data-bpo-latency]");
    elDot = injectedCol.querySelector("[data-bpo-dot]");
    elFlowChip = injectedCol.querySelector("[data-bpo-flow-chip]");
    elFlowMeta = injectedCol.querySelector("[data-bpo-flow-meta]");
    elFlowFill = injectedCol.querySelector("[data-bpo-flow-fill]");
    elLiquidityChip = injectedCol.querySelector("[data-bpo-liquidity-chip]");
    elLiquidityMeta = injectedCol.querySelector("[data-bpo-liquidity-meta]");

    if (lastPrice) {
      elPrice.textContent = formatPrice(lastPrice);
      updateLatency();
    }

    renderPairLabel();
    renderFlow();
    renderLiquidity();

    if (ws && ws.readyState === WebSocket.OPEN) {
      elDot.className = "bpo-dot";
    } else {
      elDot.className = "bpo-dot disconnected";
    }

    console.log("[" + EXTENSION_NAME + "] injected into price row");
    return true;
  }

  function pollForInjection() {
    syncTrackedAsset();

    const context = findPriceContext();
    const row = context?.row || null;
    if (row) cleanupInjectedNodes(row);

    const hasLiveInjection =
      injectedCol &&
      document.body.contains(injectedCol) &&
      row &&
      row.contains(injectedCol) &&
      (!injectedDivider || row.contains(injectedDivider));

    if (!hasLiveInjection) {
      resetInjectedRefs();
    }

    if (row) {
      if (!injectColumn(context)) return;
      ensureRightmostPlacement(row);
      return;
    }

    cleanupInjectedNodes(null);
    injectColumn(context);
  }

  setInterval(pollForInjection, POLL_INTERVAL_MS);
  pollForInjection();
  setTimeout(pollForInjection, 500);
  setTimeout(pollForInjection, 1500);
  setTimeout(pollForInjection, 3000);

  function flashTick(direction) {
    if (!elPrice) return;
    elPrice.classList.remove("bpo-tick-up", "bpo-tick-down");
    void elPrice.offsetWidth;
    elPrice.classList.add(direction === "up" ? "bpo-tick-up" : "bpo-tick-down");
    clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => {
      if (elPrice) elPrice.classList.remove("bpo-tick-up", "bpo-tick-down");
    }, 300);
  }

  function pruneFlow(now) {
    while (aggFlow.length && now - aggFlow[0].ts > FLOW_RETENTION_MS) {
      aggFlow.shift();
    }
  }

  function getFlowStats(windowMs, now) {
    let buy = 0;
    let sell = 0;

    for (let index = aggFlow.length - 1; index >= 0; index -= 1) {
      const event = aggFlow[index];
      if (now - event.ts > windowMs) break;
      if (event.isSell) sell += event.notional;
      else buy += event.notional;
    }

    const total = buy + sell;
    const net = buy - sell;
    const dominance = total > 0 ? net / total : 0;

    return { buy, sell, total, net, dominance };
  }

  function recomputeBookMetrics() {
    const hasBook =
      isFinite(bestBidPrice) &&
      isFinite(bestBidQty) &&
      isFinite(bestAskPrice) &&
      isFinite(bestAskQty) &&
      bestBidPrice > 0 &&
      bestAskPrice > 0;

    if (!hasBook) return;

    const totalQty = bestBidQty + bestAskQty;
    lastMidPrice = (bestBidPrice + bestAskPrice) / 2;
    spreadBps =
      lastMidPrice > 0 ? ((bestAskPrice - bestBidPrice) / lastMidPrice) * 10000 : 0;
    bookImbalance = totalQty > 0 ? (bestBidQty - bestAskQty) / totalQty : 0;
  }

  function getSessionLiquidityBias(now) {
    const date = new Date(now);
    const day = date.getDay();
    const hour = date.getHours();
    const isWeekend = day === 0 || day === 6;
    const isOvernight = hour < 6;
    const isLate = hour >= 20;

    let penalty = 0;
    let label = "US hours";

    if (isWeekend) {
      penalty += 0.23;
      label = "Weekend";
    }

    if (isOvernight) {
      penalty += 0.2;
      label = isWeekend ? "Weekend overnight" : "Overnight";
    } else if (hour < 8) {
      penalty += 0.08;
      label = isWeekend ? "Weekend morning" : "Early";
    } else if (isLate) {
      penalty += 0.1;
      label = isWeekend ? "Weekend late" : "Late";
    }

    return {
      penalty: clamp(penalty, 0, 0.38),
      label,
    };
  }

  function computeLiquidity(now) {
    pruneFlow(now);

    const flow3s = getFlowStats(PRIMARY_FLOW_WINDOW_MS, now);
    const flow10s = getFlowStats(10000, now);
    const hasBook =
      isFinite(bestBidPrice) &&
      isFinite(bestBidQty) &&
      isFinite(bestAskPrice) &&
      isFinite(bestAskQty) &&
      bestBidPrice > 0 &&
      bestAskPrice > 0;

    const topBookUsd = hasBook
      ? bestBidPrice * bestBidQty + bestAskPrice * bestAskQty
      : 0;

    if (flow10s.total <= 0 && topBookUsd <= 0) {
      return {
        score: 0,
        tone: "mid",
        label: "Loading",
        meta: "Waiting for book",
      };
    }

    const session = getSessionLiquidityBias(now);
    const depthFactor = clamp(topBookUsd / 3000000, 0, 1);
    const flowFactor = clamp(flow10s.total / 12000000, 0, 1);
    const burstFactor = clamp(flow3s.total / 4500000, 0, 1);
    const tightSpreadFactor = 1 - clamp((spreadBps - 0.12) / 1.0, 0, 1);
    const score = clamp(
      Math.round(
        (
          depthFactor * 0.42 +
          flowFactor * 0.33 +
          burstFactor * 0.13 +
          tightSpreadFactor * 0.12 -
          session.penalty * 0.6
        ) * 100
      ),
      0,
      100
    );

    let tone = "mid";
    let label = "Normal";
    if (score <= 35) {
      tone = "low";
      label = "Thin";
    } else if (score >= 70) {
      tone = "high";
      label = "Deep";
    }

    let detail = "warming";
    if (topBookUsd > 0) {
      detail = "book " + formatCompactUsd(topBookUsd);
    } else if (flow10s.total > 0) {
      detail = "flow " + formatCompactUsd(flow10s.total) + "/10s";
    } else if (spreadBps > 0.01) {
      detail = "spr " + formatBps(spreadBps);
    }

    return {
      score,
      tone,
      label,
      meta: session.label + " | " + detail,
    };
  }

  function computeFlow(now) {
    pruneFlow(now);

    const flow1s = getFlowStats(1000, now);
    const flow3s = getFlowStats(PRIMARY_FLOW_WINDOW_MS, now);

    if (flow3s.total <= 0 && !lastMidPrice) {
      return {
        score: 0,
        tone: "neutral",
        label: "Warming",
        meta: "Waiting for live flow",
      };
    }

    const intensity = clamp(flow3s.total / MAX_FLOW_SATURATION_USD, 0, 1);
    const bias = flow3s.dominance;
    const biasAbs = Math.abs(bias);
    const shortBurst = clamp(Math.abs(flow1s.dominance), 0, 1);
    const score = clamp(
      Math.round((biasAbs * 0.7 + intensity * 0.2 + shortBurst * 0.1) * 100),
      0,
      100
    );

    let tone = "neutral";
    let label = "Balanced";
    if (bias >= 0.3) {
      tone = "buy";
      label = "Buy pressure";
    } else if (bias >= 0.12) {
      tone = "buy";
      label = "Buy leaning";
    } else if (bias <= -0.3) {
      tone = "sell";
      label = "Sell pressure";
    } else if (bias <= -0.12) {
      tone = "sell";
      label = "Sell leaning";
    }

    const netSide = flow3s.net >= 0 ? "net B" : "net S";
    const netText =
      flow3s.total > 0 ? netSide + " " + formatCompactUsd(Math.abs(flow3s.net)) : "warming";
    const totalText =
      flow3s.total > 0 ? formatCompactUsd(flow3s.total) + "/3s" : "low flow";

    let detail = totalText;
    if (spreadBps > 0.01) {
      detail = "spr " + formatBps(spreadBps);
    } else if (Math.abs(bookImbalance) > 0.12) {
      detail = (bookImbalance > 0 ? "bid" : "ask") + " stack";
    }

    return {
      score,
      tone,
      label,
      meta: netText + " | " + detail,
    };
  }

  function updatePanel(force) {
    const now = Date.now();
    if (!force && now - lastPanelRenderTs < PANEL_RENDER_INTERVAL_MS) return;

    lastPanelRenderTs = now;
    latestFlow = computeFlow(now);
    latestLiquidity = computeLiquidity(now);
    renderFlow();
    renderLiquidity();
  }

  function handleTrade(data) {
    const price = data?.p;
    const tradeTime = data?.T;
    if (!price) return;

    const now = Date.now();
    lastMessageTs = now;
    latencyMs = tradeTime ? now - tradeTime : latencyMs;
    prevPrice = lastPrice;
    lastPrice = price;

    if (elPrice) {
      elPrice.textContent = formatPrice(price);
    }

    if (prevPrice !== null) {
      const diff = parseFloat(price) - parseFloat(prevPrice);
      if (diff > 0) flashTick("up");
      else if (diff < 0) flashTick("down");
    }

    updateLatency();
    updatePanel(false);

    if (elDot) elDot.className = "bpo-dot";
  }

  function handleAggTrade(data) {
    const price = parseFloat(data?.p);
    const qty = parseFloat(data?.q);
    if (!isFinite(price) || !isFinite(qty) || qty <= 0) return;

    const now = Date.now();
    lastMessageTs = now;

    aggFlow.push({
      ts: typeof data?.T === "number" ? data.T : now,
      notional: price * qty,
      isSell: Boolean(data?.m),
    });

    pruneFlow(now);
    updatePanel(false);

    if (elDot) elDot.className = "bpo-dot";
  }

  function handleBookTicker(data) {
    const bidPrice = parseFloat(data?.b);
    const bidQty = parseFloat(data?.B);
    const askPrice = parseFloat(data?.a);
    const askQty = parseFloat(data?.A);

    if (
      !isFinite(bidPrice) ||
      !isFinite(bidQty) ||
      !isFinite(askPrice) ||
      !isFinite(askQty)
    ) {
      return;
    }

    lastMessageTs = Date.now();
    bestBidPrice = bidPrice;
    bestBidQty = bidQty;
    bestAskPrice = askPrice;
    bestAskQty = askQty;

    recomputeBookMetrics();
    updatePanel(false);

    if (elDot) elDot.className = "bpo-dot";
  }

  setInterval(() => {
    if (!elDot) return;
    if (lastMessageTs && Date.now() - lastMessageTs > STALE_AFTER_MS) {
      elDot.className = "bpo-dot stale";
    }
  }, 1000);

  function connect() {
    if (!activeAsset?.isSupported || !activeAsset.streamSymbol) {
      return;
    }

    if (
      ws &&
      (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(buildWsUrl(activeAsset.streamSymbol));
    const socketAssetKey = activeAsset.key;

    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      console.log("[" + EXTENSION_NAME + "] Binance WS connected (" + activeAsset.pairLabel + ")");
      reconnectDelay = RECONNECT_BASE_MS;
      if (elDot) elDot.className = "bpo-dot";
    };

    socket.onmessage = (event) => {
      if (ws !== socket || activeAsset.key !== socketAssetKey) return;
      try {
        const payload = JSON.parse(event.data);
        const stream = payload?.stream || "";
        const data = payload?.data || payload;

        if (stream.endsWith("@trade") || data?.e === "trade") {
          handleTrade(data);
          return;
        }

        if (stream.endsWith("@aggTrade") || data?.e === "aggTrade") {
          handleAggTrade(data);
          return;
        }

        if (stream.endsWith("@bookTicker") || data?.e === "bookTicker") {
          handleBookTicker(data);
        }
      } catch (error) {
        console.warn("[" + EXTENSION_NAME + "] WS parse error", error);
      }
    };

    socket.onerror = () => {
      if (ws !== socket) return;
      console.warn("[" + EXTENSION_NAME + "] WS error (" + activeAsset.pairLabel + ")");
    };

    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      console.log(
        "[" + EXTENSION_NAME + "] WS closed, reconnecting in " + reconnectDelay + "ms"
      );
      if (elDot) elDot.className = "bpo-dot disconnected";
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    };
  }

  syncTrackedAsset();
  connect();
  updatePanel(true);

  window.addEventListener("beforeunload", () => {
    disconnectSocket();
  });
})();
