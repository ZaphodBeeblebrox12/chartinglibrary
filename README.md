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

The current database schema does not persist the expiry used by each snapshot, even though the capture pipeline knows the active expiry. A backward-compatible schema/API change is therefore a required integration task for reliable expiry-specific chart history. Existing rows with unknown expiry must remain explicitly unknown; do not fabricate a backfill.

## Repository status

A runnable React + TypeScript + Vite frontend is being implemented on the `feat/tradethesis-charts-app` branch. The initial workstation uses the OpenAlgo Charts 2.7.5 widget, supports both themes, and includes a custom feed for the existing local API. Run the verification workflow before treating the branch as release-ready.

## Local development target

- Charts frontend: `http://localhost:5173`
- Existing Options Dashboard API: `http://localhost:8000`

The chart frontend uses a Vite development proxy to the existing FastAPI service. Historical index candles come from `/api/scanner/candles`; option LTP observations come from `/api/history/{strike}`. The Options Dashboard remains a separate application and its existing UI is not changed by this project. Historical option expiry is currently unknown in legacy rows. The first chart must label this accurately until a nullable expiry field is persisted by the source backend.

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
