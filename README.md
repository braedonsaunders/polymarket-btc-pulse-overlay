# BTC Pulse Overlay

Fast market context. Zero trade calls.

BTC Pulse Overlay is a read-only browser extension that adds a live Binance spot reference panel directly into compatible Polymarket price pages. It surfaces price, latency, short-term flow, and liquidity in the place people already look, without placing orders, clicking buttons, or telling anyone what to trade.

If your first question on a compatible market page is "what is spot doing right now?", this extension answers it immediately.

![BTC Pulse Overlay screenshot](screenshot.png)

## What it shows

- Live Binance spot reference price for supported assets
- WebSocket latency to the latest trade print
- Short-term aggressor flow bias
- Lightweight liquidity context from depth, spread, and recent flow

## What it does not do

- Place trades
- Click buttons
- Automate the site
- Emit entry or exit instructions
- Claim affiliation with Polymarket or Binance

## Compatible pages

The current version is tuned for Polymarket price markets where a visible `Price to beat` row exists on the page.

Currently verified assets:

- BTC
- ETH
- SOL
- XRP
- DOGE
- BNB

Unsupported 5-minute assets show an unavailable label instead of falling back to BTC.

## Install

1. Clone or download this repo.
2. Open `chrome://extensions` in a Chromium-based browser.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this folder.
6. Open a compatible Polymarket price page.

## Local development

There is no build step.

1. Edit [`content.js`](content.js) or [`manifest.json`](manifest.json).
2. Reload the extension from `chrome://extensions`.
3. Refresh the target page.

## Design guardrails

This project should remain:

- Read-only
- Small and understandable
- Easy to audit
- Respectful of the platform it runs on

Changes that introduce order placement, automation, account actions, or "you should trade this now" style guidance are out of scope for the public repo.

## Contributing

Bug reports, UI fixes, compatibility improvements, and observability ideas are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Security

Please report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## License

MIT. See [`LICENSE`](LICENSE).

## Disclaimer

This is an unofficial community project. It is not affiliated with, endorsed by, or sponsored by Polymarket or Binance. Users are responsible for complying with the terms, laws, and rules that apply to their own use.
