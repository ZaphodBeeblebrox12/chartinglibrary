# TradeThesis Charts — Implementation Plan

## 1. Confirmed product decisions

| Decision | Choice |
|---|---|
| Product name | TradeThesis Charts |
| Chart engine | OpenAlgo Charts |
| UI framework | React + TypeScript |
| Bundler | Vite |
| Theme | Light and dark, user-toggleable |
| Deployment | Local-first; no cloud deployment in this plan |
| Initial underlyings | NIFTY and SENSEX |
| Historical source | Existing Options Dashboard SQLite database |
| Live source | Existing Options Dashboard backend only, after payload audit |
| Broker connection | No additional Angel One session/WebSocket |

The charting application is standalone. It must not be mounted inside the Options Dashboard frontend or require that frontend to be open. It may use the existing Options Dashboard backend as a local data service.

## 2. What the existing backend already provides

The inspected Options Dashboard repository is a Python/FastAPI + SQLite WAL backend with a React/Vite frontend.

Relevant existing functionality:

- `GET /api/current?index=NIFTY|SENSEX` returns the latest index snapshot and option chain.
- `GET /api/history/{strike}?date=YYYY-MM-DD&index=NIFTY|SENSEX` returns timestamped CE/PE observations for a strike, including LTP, OI, OI change, volume, IV, Delta, Gamma, Theta, Vega and GEX.
- `GET /api/snapshots` and `GET /api/snapshot/{timestamp}` support snapshot navigation/replay.
- `GET /api/available-dates` exposes dates containing saved data.
- `/ws` is the existing live-state WebSocket; its exact event cadence and payload should be verified before using it for chart updates.
- `candles_1m` is a separate one-minute OHLC store for symbols whose cash ticks are passed through the candle builder. It is not the option-premium candle store.

The option-chain snapshots are captured on an approximately 30-second cadence. The chart app should read this stored history; it should not create a second broker feed.

## 3. Critical data-model issue: expiry identity

The current schema has:

- `snapshots(timestamp, index_name, spot, futures, ...)`
- `option_snapshots(snapshot_id, index_name, strike, option_type, ltp, oi, volume, iv, delta, gamma, theta, vega, gex, ...)`

The capture pipeline resolves the active expiry into `expiry_key` (`ek`) before analytics, but `_write_snapshot_to_db` does not persist that value. Consequently, the historical option rows do not independently identify the expiry contract.

### Required forward-compatible fix

Before treating historical records as exact contract history:

1. Add a nullable `expiry` column to `snapshots`.
2. Put the resolved expiry key into the captured snapshot payload.
3. Persist it with the parent snapshot row in the same DB transaction.
4. Include expiry in the history query and chart API response.
5. Add an index only if query plans/volume justify it.
6. Preserve old rows as `expiry = NULL`; do not infer expiry from today's instrument master.
7. When expiry is unknown, label that series as legacy/unknown and prevent it being merged into an expiry-specific series.

The parent snapshot is the appropriate place for expiry because each NIFTY/SENSEX snapshot represents one active option-chain expiry for that capture. An option row inherits that expiry through `snapshot_id`.

This is a small, backward-compatible migration in the Options Dashboard backend. It does not require changing its frontend or broker streamer.

## 4. Snapshot-derived chart data: honest semantics

The database stores sampled points approximately every 30 seconds. It does not store every option trade or true per-contract tick OHLC.

Initial chart behavior:

- Keep every recorded LTP observation as a timestamped point.
- Use a line chart as the most truthful default for option premium history.
- Where the chart experience requires candles, aggregate the observed LTP samples into **snapshot-derived bars** and label them as such.
- The observed high/low in a derived bar means the highest/lowest captured sample, not necessarily the true exchange high/low.
- Do not synthesize observations during missing intervals. Preserve gaps.
- Derive volume increments from consecutive cumulative-volume readings only when both readings are valid and belong to the same date/contract. Treat resets, invalid readings and negative deltas as unknown rather than zero.
- OI, IV and Greeks are sampled time-series; they are not OHLC values.
- Underlying spot is also available in the parent snapshot table and can be plotted as an observed series.

A future tick-recorder or historical broker candle source could improve candle fidelity, but it is deliberately outside the first release.

## 5. Delivery phases

### Phase 0 — Data contract and compatibility audit

- Freeze the current repository as a separate standalone project.
- Confirm the local Options Dashboard API address, payloads, authentication/CORS behavior and database path.
- Implement the nullable expiry persistence migration in the Options Dashboard backend.
- Add a new read-only chart-history API that accepts index, expiry, strike, CE/PE, date range and requested interval.
- Keep legacy rows with unknown expiry separate.
- Verify the existing WebSocket payload and decide whether it can supply live updates; otherwise update on successful snapshot/API refresh without creating a new broker feed.
- Add tests for expiry persistence, legacy rows, data gaps, duplicate timestamps and volume validity.

**Exit criteria:** NIFTY and SENSEX historical option observations can be requested without expiry mixing, and all fields have documented provenance.

### Phase 1 — Chart engine prototype

- Create a React + TypeScript + Vite application.
- Pin a reviewed OpenAlgo Charts release; do not follow an unpinned latest version.
- Integrate the full OpenAlgo widget, drawing tier and indicator tier.
- Implement light/dark toggle and remember the choice locally.
- Start with deterministic fixture data.
- Add lifecycle cleanup for chart creation/destruction and React development Strict Mode.
- Confirm resize, fullscreen, keyboard shortcuts and toolbar behavior.

**Exit criteria:** a local standalone chart with sample data, drawing rail, indicator picker, working theme toggle and no dependency on the Options Dashboard UI.

### Phase 2 — Historical database adapter

- Implement a TradeThesis `DataFeed` adapter for OpenAlgo Charts.
- Add index and contract selectors for NIFTY/SENSEX, expiry, strike and CE/PE.
- Load LTP observations and sampled bars from the new read-only chart-history API.
- Add line and snapshot-derived candlestick views.
- Display the capture cadence and data-quality warnings.
- Plot OI, IV, Greeks and valid volume deltas in separate indicator panes.
- Support date navigation using available database dates.

**Exit criteria:** the user can select an exact saved NIFTY or SENSEX expiry/strike/side and see historical observations from the dashboard database.

### Phase 3 — Live snapshot updates

- Reuse the existing backend's read-only live state or snapshot notification path.
- Update the active series without reloading the full chart.
- Handle reconnects, stale data, missed snapshots and contract rollovers.
- Keep historical loading and live updates consistent.
- Do not add an independent Angel One socket.

**Exit criteria:** an open chart receives new stored observations while the Options Dashboard backend is running, and clearly indicates stale/disconnected state.

### Phase 4 — TradingView-style workstation polish

- Instrument search and recent contracts.
- Timeframe and chart-type menus.
- Drawing favorites, magnet, lock/hide, undo/redo and object manager.
- Indicator templates and settings.
- Workspace/layout save and restore.
- Multiple synchronized charts.
- Screenshot/export and keyboard shortcuts.
- Light/dark theme refinements.

**Exit criteria:** persistent technical-analysis workflow that is comfortable for daily use.

### Phase 5 — TradeThesis options tools

- OI and change-in-OI panels.
- IV, Delta, Gamma, Theta and Vega history.
- CE/PE comparison.
- Underlying vs selected option premium.
- Existing OI walls and other support/resistance overlays.
- Custom TradeThesis indicators and alerts after the base chart is stable.

**Exit criteria:** options-specific analytical features integrated without compromising ordinary chart behavior.

## 6. Proposed repository structure

```text
chartinglibrary/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── chart/
│   │   │   ├── engine/
│   │   │   ├── datafeed/
│   │   │   ├── instruments/
│   │   │   ├── overlays/
│   │   │   └── workspace/
│   │   ├── options/
│   │   ├── api/
│   │   ├── hooks/
│   │   └── styles/
│   └── tests/
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   ├── ARCHITECTURE.md
│   └── DATA_CONTRACTS.md
├── fixtures/
├── scripts/
├── README.md
└── .gitignore
```

Do not copy the Options Dashboard backend into this repository. The first local application should proxy requests to the existing FastAPI service. Add a small local adapter service only if the existing backend cannot safely expose the required read-only contract API.

## 7. Local developer workflow target

- Options Dashboard backend: `http://127.0.0.1:8000` (existing service).
- TradeThesis Charts frontend: `http://127.0.0.1:5173` (new service).
- Vite proxies `/api` and the chart data WebSocket path to the existing backend as required.
- Secrets remain in the Options Dashboard backend's existing environment; never copy broker keys/JWTs into the chart frontend.
- The chart application should start and render fixture data even when the backend is offline.

## 8. Acceptance gates

1. **Isolation:** starting/stopping Charts does not start/stop or alter the Options Dashboard.
2. **Data correctness:** exact expiry/strike/side identity; unknown legacy expiry never silently merged.
3. **Data provenance:** sampled option observations are clearly distinguished from true exchange OHLC.
4. **No duplicate brokerage feed:** Charts does not log into Angel One or open a new broker WebSocket.
5. **Resilience:** stale/missing samples create gaps/status, not fabricated flat prices.
6. **Persistence:** saved chart drawings/layouts restore after restart.
7. **Themes:** light and dark both work across chart canvas and widget controls.
8. **Dual index:** NIFTY and SENSEX are both selectable and independently charted.
9. **Tests:** unit tests for mapping/aggregation and browser tests for chart lifecycle, theme switching and saved state.

## 9. Out of scope until explicitly requested

- Cloud/Render deployment.
- User accounts or public multi-user access.
- Order execution.
- A new Angel One market-data session.
- Reconstructing historical exact-expiry labels where the source database never stored them.
- Treating 30-second observations as tick-perfect exchange candles.
