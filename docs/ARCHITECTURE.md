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

The snapshot writer now persists the already-resolved expiry key into nullable `snapshots.expiry` in the same parent snapshot row. The migration is backward-compatible; old rows remain `NULL` and must never be assigned today's expiry retroactively.

Current snapshot cadence is approximately 30 seconds. The chart API `GET /api/chart/options/expiries` lists session expiries; `GET /api/chart/options/history` selects one exact expiry, strike and side (or the separate `UNKNOWN` legacy series). Queries use parent snapshot IDs and the `idx_snapshots_expiry_index_ts` index.

### Existing underlying OHLC — reuse it

The Options Dashboard already builds tick-based one-minute OHLC for underlying CASH/spot instruments:

- `streamer_integration.py` sends NIFTY/SENSEX spot ticks to `candle_feed.on_tick(index_name, message)`.
- `stock_streamer.py` sends CASH ticks for STOCK-kind instruments to the same builder.
- `candle_builder.py` constructs one-minute OHLC using tick prices and the exchange timestamp where valid, then persists to `candles_1m`.
- `main.py` exposes `GET /api/scanner/candles?symbol=...&tf=5m|15m|30m|1H&date=...`, deriving higher timeframes from stored 1m candles.

This is genuine tick-built underlying OHLC, not option-premium OHLC. Reuse it for NIFTY/SENSEX underlying charts. The CASH/spot candles currently have null volume because the tick mode used here does not carry LTQ.


The legacy endpoint `GET /api/history/{strike}` remains unchanged for the Options Dashboard UI. TradeThesis Charts uses the new expiry-aware chart endpoints so it does not combine different option contracts.

## 3. Frontend modules

- **App shell:** top bar, instrument selector, theme switch, workspace chrome.
- **Chart host:** owns OpenAlgo widget lifecycle; mount once after container sizing, destroy on unmount.
- **TradeThesisDataFeed:** adapts local expiry-aware historical HTTP endpoints into OpenAlgo's DataFeed contract; optionally delegates `subscribeBars` to an independent `RealtimeProvider`.
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

## 5A. Independent historical and realtime providers

The application deliberately separates the source of historical bars from the source of live updates:

- `TradeThesisDataFeed.getBars()` reads saved history from the existing Options Dashboard FastAPI endpoints.
- An optional `RealtimeProvider` implements the OpenAlgo `subscribeBars()` contract. It can be attached later without changing the React shell, chart widget, symbol selectors or historical adapter.
- The initial app does not configure a realtime provider. It runs in historical mode and must not imply that data is streaming.
- A future realtime provider may consume the Options Dashboard's existing server-side streamer, or a dedicated Angel One gateway if that becomes the chosen operating model. Its output contract remains the same.

For an Angel One integration, prefer a backend adapter that owns authentication, subscriptions, reconnects and tick-to-bar aggregation. The browser must not receive Angel One API keys, JWTs, feed tokens or order credentials. Do not open another SmartAPI WebSocket if the existing backend session can supply the required instruments. If the user later explicitly chooses an independent Angel One session, document its subscription limits and ownership before enabling it.

The realtime adapter must:
- Map the provider's exchange timestamps to UTC epoch seconds before chart delivery.
- Resolve exact instrument identity, including expiry for options.
- Build the chart interval from ticks (or consume a verified server-side candle stream), rather than treating every tick as a completed bar.
- Seed live aggregation from the last historical bar when history and live data share a candle interval.
- Suppress duplicate/out-of-order events and never invent prices across disconnections.
- Report connecting/live/reconnecting/disconnected states and request an authoritative history resync after a gap.
- Unsubscribe cleanly when symbol, interval or chart changes.

Historical data remains the source of truth for backfill. Realtime data extends the right edge of that history; it does not replace or rewrite older observations.

## 6. Time and bar semantics

All stored snapshot timestamps use the backend's local timestamp convention. The adapter must parse them explicitly as Asia/Kolkata time and convert to the chart library's expected time representation without accidental browser-local or UTC shifts.

Option premium history is a sequence of approximately 30-second sampled LTP observations. A snapshot-derived bar uses only observations that actually exist in the interval. Missing intervals remain gaps. The bar's high/low are observed-sample extrema, not guaranteed market extremes. This provenance must be visible in the UI.

Prefer LTP line view as the default historical representation. Candlestick view can be offered as a snapshot-derived display with an explanatory label.

## 7. Read-only and safety boundaries

- New chart endpoints are read-only.
- Do not expose API keys, JWTs, broker credentials or account actions in the browser.
- Do not execute or submit trades from the initial app.
- Charts should work with fixture data when the API is unavailable.
- The expiry migration and chart-history API live in the Options Dashboard repository; they are backward-compatible and tested separately from this frontend.
