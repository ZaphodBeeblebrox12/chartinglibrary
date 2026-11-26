# TradeThesis Charts

A standalone, local-first charting workstation for personal use.

The goal is a TradingView-style charting experience powered by **OpenAlgo Charts**, connected to the historical option-chain data already collected by the TradeThesis Options Dashboard.

## Project decisions

- **Application:** TradeThesis Charts
- **Chart engine:** [OpenAlgo Charts](https://github.com/marketcalls/openalgo-charts)
- **Frontend:** React + TypeScript + Vite
- **Appearance:** Light and dark themes
- **Development and use:** Local-first
- **Initial markets:** NIFTY, SENSEX and BTC/USDT spot (Binance / OKX)
- **Historical source:** Existing Options Dashboard SQLite database, accessed through its FastAPI backend
- **Broker connectivity:** No separate Angel One login or WebSocket connection in this application

## Important data constraint

The Options Dashboard records snapshots approximately every 30 seconds. Its `snapshots` table stores the index spot and snapshot timestamp; `option_snapshots` stores strike, CE/PE, LTP, OI, volume, IV and Greeks.

These are sampled observations, not exchange tick-by-tick OHLC candles. The first version must preserve and label that distinction:

- Show observed LTP points accurately.
- Where candlesticks are generated from snapshots, label them as **snapshot-derived bars**.
- Do not claim the observed high/low equals the true traded high/low between snapshots.
- Calculate volume increments only from consecutive valid cumulative-volume readings.
- Do not join historical option data across expiries unless expiry identity is known.

The Options Dashboard source backend now has a backward-compatible nullable `snapshots.expiry` migration and writes the resolved expiry for new captures. Historical rows created before that migration remain `NULL` and are selectable only as **Legacy / expiry unknown**; do not fabricate a backfill.

## Repository status

The `main` branch contains the runnable React + TypeScript + Vite workstation. It uses the OpenAlgo Charts 2.7.5 widget, supports both themes, and includes historical adapters for the Options Dashboard plus public Binance and OKX BTC/USDT spot adapters. Automated checks cover TypeScript, unit tests, the production build and Playwright Chromium browser tests.

## Local development target

- Charts frontend: `http://localhost:5173`
- Existing Options Dashboard API: `http://localhost:8000`

The chart frontend uses a Vite development proxy to the existing FastAPI service. Historical index candles come from `/api/scanner/candles`; option expiry choices come from `/api/chart/options/expiries`; expiry-filtered LTP observations come from `/api/chart/options/history`; and the expiry-specific strike selector uses `/api/chart/options/strikes`. Public BTC spot history is served by `/api/chart/crypto/candles`. The Options Dashboard remains a separate application and its existing UI is not changed by this project. Legacy option rows remain explicitly expiry-unknown.

## Local quick start

Requirements: Node.js 26.13.1 (see `.nvmrc`) and the existing Options Dashboard backend. Node.js 24 or newer is required.

1. Start the Options Dashboard FastAPI backend on `http://127.0.0.1:8000` using its normal development command.
2. From this repository root, run `npm ci` to install the committed lockfile exactly.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

To point the Vite proxy at a different local backend, create `frontend/.env` from `frontend/.env.example` and set `VITE_OPTIONS_API_TARGET`. To use a shared SQLite file stored outside the Options Dashboard backend folder, set `TRADETHESIS_DB_PATH` in `Options-Dashboard/backend/.env` to its absolute path (use forward slashes on Windows). Do not place broker credentials in the chart frontend.

Run `npm ci` to install the exact committed dependency tree, then `npm run check` for TypeScript, unit tests and the production build. Run `npm run test:e2e` for the Playwright Chromium browser smoke tests. NIFTY/SENSEX use historical local database candles; BTC spot loads exchange history and subscribes to the selected venue's public live candle stream for the current UTC day. Demo fixtures are shown only for the index/option chart when the local backend cannot be reached, and are explicitly labelled.

## Bitcoin spot markets

TradeThesis Charts also offers BTC/USDT spot candles from **Binance** and **OKX**.

- Historical OHLCV is fetched through the Options Dashboard backend from each exchange's public REST market-data API.
- The current UTC session also subscribes directly in the browser to that exchange's public candlestick WebSocket stream.
- No exchange API key or trading permission is required for these public market-data endpoints.
- Binance BTCUSDT and OKX BTC-USDT remain separate instruments: prices and volumes are not mixed or normalized across venues.
- Historical date selection uses UTC for Bitcoin. Selecting an older date disables the live subscription and displays historical candles only.
- Spot volume is the exchange's reported base-asset volume; it is not directly comparable with index cash-feed volume or derivative contract volume.

The backend route is `GET /api/chart/crypto/candles?exchange=BINANCE|OKX&interval=5m&date=YYYY-MM-DD`.

## Documentation

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data contracts and quality rules](docs/DATA_CONTRACTS.md)

## Non-goals for the first milestone

- No changes to the existing Options Dashboard frontend.
- No new Angel One authentication or market-data connection.
- No Render deployment requirement.
- No attempt to execute orders.
- No pretending sampled snapshots are true exchange OHLC data.
