# TradeThesis Charts

A standalone, local-first, TradingView-style charting workstation for TradeThesis. It uses **OpenAlgo Charts 2.7.5**, React, TypeScript and Vite, and reads Indian-market history from the existing TradeThesis Options Dashboard backend.

## Current capabilities

### Chart workstation
- Multi-chart grid layouts from 1x1 up to 3x2, with synchronized crosshairs and chart viewports.
- Light and dark themes, drawing rail, indicator registry, chart toolbar and fullscreen support.
- Saved chart context and named workspaces, including grid state.
- Drawing favorites and tool catalogue, magnet modes, undo/redo, eraser, object selection, grouping, visibility, locking and deletion.

### Markets and data sources
- **NIFTY and SENSEX:** historical tick-built underlying candles from the Options Dashboard SQLite store; the existing backend /ws stream supplies newly committed live candles.
- **Options:** expiry-aware CE/PE historical LTP observations, strike and expiry selection, latest option-chain analytics and live option metrics from the existing Options Dashboard state broadcast.
- **Configured Indian cash equities:** history and live candles for instruments configured/tracked by the Options Dashboard.
- **Configured MCX futures:** front-month futures instruments only, with MCX session handling. These are not commodity spot benchmarks.
- **Bitcoin spot:** BTC/USDT from Binance and OKX, with venue-specific historical OHLCV and public live candlestick streams.
- **Global markets:** Biquote symbol catalogue, historical indicative OHLC and SignalR live candles for supported Forex, commodity, crypto, index and stock/CFD instruments.

The configured cash and MCX lists depend on the instruments enabled in the Options Dashboard. The Biquote catalogue and provider availability depend on the public provider being reachable.

## Data semantics and limitations

The Options Dashboard saves option-chain observations approximately every 30 seconds. Option premium charts use sampled observations grouped into labelled one-minute bars; their high/low represent captured samples, not the complete exchange-traded high/low. OI, IV, Greeks and GEX are observations/metrics, not OHLC prices. Legacy rows whose expiry was not saved remain isolated as **Legacy / expiry unknown**. The application does not infer historical expiry identities.

NIFTY/SENSEX and configured Indian cash/MCX candles are built from actual subscribed ticks and persisted by the existing backend. A tick-built candle still reflects only the backend's subscribed feed and session coverage.

Binance and OKX prices/volumes are exchange-specific and must not be mixed. Biquote data is indicative provider data, not guaranteed executable pricing; Forex/CFD volume is tick volume rather than centralized exchange-traded volume, and the provider's historical window is rolling rather than an unlimited archive.

No broker credentials belong in the chart frontend. Charts does not create another Angel One login or market-data WebSocket; the Indian-market realtime provider reuses the existing Options Dashboard backend /ws stream. This application does not place or execute orders.

## Architecture

- **Frontend:** React + TypeScript + Vite (http://127.0.0.1:5173)
- **Data backend:** existing Options Dashboard FastAPI service (http://127.0.0.1:8000)
- **Database:** the SQLite database opened by the Options Dashboard backend, optionally redirected with TRADETHESIS_DB_PATH
- **Indian-market realtime:** existing backend /ws; no separate Angel One session
- **Crypto history:** backend REST adapters for public Binance/OKX market data
- **Crypto realtime:** browser subscriptions to the selected exchange's public candlestick WebSocket
- **Global market data:** Biquote public history and SignalR hub

The chart frontend proxies /api and /ws to the Options Dashboard backend. Relevant read-only endpoints include:

- GET /api/scanner/candles
- GET /api/available-dates
- GET /api/chart/options/expiries
- GET /api/chart/options/strikes
- GET /api/chart/options/history
- GET /api/chart/options/chain
- GET /api/chart/crypto/candles
- GET /api/instruments
- /ws for existing backend live state and committed candle broadcasts

## Local quick start (Windows PowerShell)

Requirements: Node.js 26.13.1 as pinned in .nvmrc (Node.js 24 or newer is required).

1. Update the Options Dashboard repository:

        cd C:\Projects\Options-Dashboard
        git pull origin main

2. Configure the copied database in Options-Dashboard/backend/.env if needed. Example:

        TRADETHESIS_DB_PATH=C:/Projects/chartinglibrary/nifty_snapshots.db

   Use the absolute path to your copy. Do not delete SQLite -wal or -shm files while a backend is using the database.

3. Start the backend in Terminal 1:

        cd C:\Projects\Options-Dashboard\backend
        .\.venv\Scripts\Activate.ps1
        pip install -r requirements.txt
        python main.py

4. Update and start Charts in Terminal 2:

        cd C:\Projects\chartinglibrary
        git pull origin main
        npm ci
        npm run dev

5. Open http://127.0.0.1:5173.

To proxy to a backend at another address, create frontend/.env from frontend/.env.example and set VITE_OPTIONS_API_TARGET. Keep all broker secrets in the backend environment only.

## Verification commands

From the chart repository root:

        npm run check
        npm run test:e2e

The chart PR's CI passed TypeScript checks, unit tests, production build and all five Playwright Chromium smoke tests. The companion Options Dashboard PR's CI passed backend compilation/unit tests, frontend typecheck/build, and replay/freshness regression tests. Those automated checks use mocked or test fixtures where appropriate; they do not validate your copied SQLite file, Windows path configuration, or live exchange/broker connectivity. Complete docs/LOCAL_TEST_PLAN.md before treating the local integration as verified.

## Project documents

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data contracts and quality rules](docs/DATA_CONTRACTS.md)
- [Local integration test plan](docs/LOCAL_TEST_PLAN.md)
