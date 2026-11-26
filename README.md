# TradeThesis Charts

A standalone, local-first charting workstation for personal use.

The goal is a TradingView-style charting experience powered by **OpenAlgo Charts**, connected to the historical option-chain data already collected by the TradeThesis Options Dashboard.

## Project decisions

- **Application:** TradeThesis Charts
- **Chart engine:** [OpenAlgo Charts](https://github.com/marketcalls/openalgo-charts)
- **Frontend:** React + TypeScript + Vite
- **Appearance:** Light and dark themes
- **Development and use:** Local-first
- **Initial markets:** NIFTY and SENSEX
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

A runnable React + TypeScript + Vite frontend is being implemented on the `feat/tradethesis-charts-app` branch. The initial workstation uses the OpenAlgo Charts 2.7.5 widget, supports both themes, and includes a custom feed for the existing local API. Run the verification workflow before treating the branch as release-ready.

## Local development target

- Charts frontend: `http://localhost:5173`
- Existing Options Dashboard API: `http://localhost:8000`

The chart frontend uses a Vite development proxy to the existing FastAPI service. Historical index candles come from `/api/scanner/candles`; option expiry choices come from `/api/chart/options/expiries`; expiry-filtered LTP observations come from `/api/chart/options/history`. The Options Dashboard remains a separate application and its existing UI is not changed by this project. Legacy rows remain explicitly expiry-unknown.

## Local quick start

Requirements: Node.js 26 LTS (see `.nvmrc`) and the existing Options Dashboard backend.

1. Start the Options Dashboard FastAPI backend on `http://127.0.0.1:8000` using its normal development command.
2. From this repository root, run `npm install`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173`.

To point the Vite proxy at a different local backend, create `frontend/.env` from `frontend/.env.example` and set `VITE_OPTIONS_API_TARGET`. No broker key or Angel One credential belongs in the frontend.

Run `npm run check` for TypeScript, unit tests and the production build. The frontend is historical-only in this first release; demo fixtures are displayed only when the backend cannot be reached and are explicitly labelled.

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
