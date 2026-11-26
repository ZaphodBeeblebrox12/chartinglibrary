# Architecture

## 1. System boundary

TradeThesis Charts is a separate browser application. It consumes read-only data from the existing Options Dashboard FastAPI backend and does not own a broker connection.

```
Angel One (existing connection)
          |
          v
Options Dashboard streamer + snapshot engine
          |
          v
Existing SQLite WAL database
  - snapshots
  - option_snapshots
          |
          v
Existing FastAPI read-only chart endpoints
          |
          v
Vite dev proxy (local)
          |
          v
TradeThesis Charts (React + OpenAlgo Charts)
```

Do not duplicate Angel One login, SmartAPI subscriptions, tick ingestion or Greeks calculation inside the charting app.

## 2. Existing data source

The current snapshot writer captures an index state and the active option chain. The resolved expiry key is available in the capture path, but the current SQL writer does not persist it. A nullable parent `snapshots.expiry` field must be added before exact historical contract selection can be guaranteed.

Current snapshot cadence is approximately 30 seconds. The primary option history path joins `snapshots` with `option_snapshots` by `snapshot_id`.

Existing endpoint `GET /api/history/{strike}?date=YYYY-MM-DD&index=NIFTY|SENSEX` returns both CE and PE observations for one strike and date. It includes timestamp, OI, OI change, volume-validity metadata, LTP, IV, Delta, Gamma, Theta, Vega and GEX. A new chart endpoint should add explicit expiry and date-range filters rather than making the frontend fetch and filter unbounded history.

## 3. Frontend modules

- **App shell:** top bar, instrument selector, theme switch, workspace chrome.
- **Chart host:** owns OpenAlgo widget lifecycle; mount once after container sizing, destroy on unmount.
- **TradeThesisDataFeed:** adapts local HTTP history and existing live notifications into OpenAlgo's DataFeed contract.
- **Instrument resolver:** NIFTY/SENSEX, expiry, strike and CE/PE. The instrument identity must be explicit and stable.
- **Series adapters:** LTP observations, snapshot-derived bars, valid volume deltas, OI, IV and Greeks.
- **Workspace persistence:** saved drawings, indicators, chart layouts and selected theme.
- **Options overlays:** walls, CE/PE comparison and other domain-specific additions, built only after base chart integration.

## 4. OpenAlgo integration

Use the widget tier rather than just the low-level canvas renderer. The documented widget provides the top bar, drawing rail, dialogs, shortcuts, settings and optional persistence.

Pin the chart engine version in the lockfile. Load the indicators and drawing tiers explicitly as required by the selected engine version. Keep engine imports and data adapter code behind `frontend/src/chart/engine` and `frontend/src/chart/datafeed` so the chart engine can be replaced later.

The OpenAlgo datafeed abstraction supports historical bar retrieval and optional live bar subscription. TradeThesis should implement a custom feed, not assume the library's OpenAlgo broker adapter speaks to the Options Dashboard API.

## 5. Historical and live transport

Initial mode:
- REST calls load historical database observations.
- The existing backend's WebSocket/event behavior is audited before subscribing.
- If the existing WebSocket pushes complete current snapshots, derive incremental updates from those payloads.
- If not, use a conservative API refresh aligned to the snapshot writer cadence until a backend notification contract is added.
- Charts never start another Angel One WebSocket.

## 6. Time and bar semantics

All stored snapshot timestamps use the backend's local timestamp convention. The adapter must parse them explicitly as Asia/Kolkata time and convert to the chart library's expected time representation without accidental browser-local or UTC shifts.

Option premium history is a sequence of sampled LTP observations. A snapshot-derived bar uses only observations that actually exist in the interval. Missing intervals remain gaps. The bar's high/low are observed-sample extrema, not guaranteed market extremes. This provenance must be visible in the UI.

Prefer LTP line view as the default historical representation. Candlestick view can be offered as a snapshot-derived display with an explanatory label.

## 7. Read-only and safety boundaries

- New chart endpoints are read-only.
- Do not expose API keys, JWTs, broker credentials or account actions in the browser.
- Do not execute or submit trades from the initial app.
- Charts should work with fixture data when the API is unavailable.
- No backend schema is altered by this frontend repository; the expiry persistence migration is made in the Options Dashboard repository separately, tested and backward-compatible.
