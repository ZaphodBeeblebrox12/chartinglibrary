# TradeThesis Charts — implementation and verification status

Updated after merging the multi-market workstation and its companion Options Dashboard backend changes into both repositories' main branches.

## 1. Product and architecture decisions

| Area | Decision |
|---|---|
| Product | TradeThesis Charts |
| Chart engine | OpenAlgo Charts 2.7.5 |
| UI | React + TypeScript + Vite |
| Deployment | Local-first workstation |
| Appearance | Light and dark themes |
| Indian market history | Existing Options Dashboard SQLite and FastAPI API |
| Indian market realtime | Existing Options Dashboard /ws broadcast |
| Crypto | Public Binance and OKX BTC/USDT spot endpoints |
| Global markets | Biquote public indicative market-data API and SignalR |
| Broker connectivity | No second Angel One login or WebSocket |
| Order execution | Not supported |

Charts is an independent frontend. It can use the Options Dashboard backend as a local data service without being embedded in or replacing the existing dashboard frontend.

## 2. Implemented feature set

### Chart workstation
- Chart grid layouts from 1x1 to 3x2.
- Linked crosshairs and viewport synchronization.
- Saved grid state and named workspaces/context.
- Light/dark themes, chart toolbar, drawing rail and fullscreen.
- Drawing favorites and catalogue, magnet settings, undo/redo, eraser, object list, selection/grouping, visibility, locking and deletion.

### Indian markets
- Historical NIFTY/SENSEX underlying candles reuse the existing tick-built one-minute candle store and /api/scanner/candles.
- The Options Dashboard backend broadcasts persisted one-minute cash/index candles to existing /ws clients after the database writer commits.
- Configured cash equities and configured MCX front-month FUTCOM instruments are available through the instrument catalogue and backend candle builder.
- MCX candles use symbol/session-aware handling and are explicitly presented as futures, not commodity spot.

### Options data and analytics
- Date- and expiry-scoped option expiry, strike and LTP-history APIs.
- A nullable snapshot expiry migration supports correct identity for new captures. Earlier records remain expiry-unknown; no expiry is inferred for legacy rows.
- Historical CE/PE premiums are sampled observations, not tick-complete exchange OHLC.
- The chart presents one-minute bars grouped from the approximately 30-second snapshot samples, with freshness/gap metadata.
- The backend exposes a read-only selected-date/expiry option-chain endpoint with CE/PE chain rows, OI walls and saved max-pain/gamma-flip/GEX levels. Max pain is estimated from OI only where the stored snapshot does not contain it, and the UI identifies that caveat.
- The UI includes OI profile, CE/PE comparison, historical spot/premium/OI/OI-change/IV/Greeks/GEX sparklines, current option metrics and live option updates.

### Global and crypto markets
- Binance and OKX BTC/USDT historical REST candles and public live candle streams remain separate venue-specific series.
- Biquote symbol catalogue, indicative historical OHLC and SignalR live candle subscription are implemented for supported asset classes. This feed is not guaranteed executable pricing; volume is provider tick volume.
- Selected historical sessions do not retain a live subscription.

### Analysis and alerts
- SMA20, EMA20 and RSI14 are calculated from actual loaded/live bar closes.
- Local persistent alert rules support price/spot, technical metrics and option metrics, with optional browser notifications after permission is granted.
- Alerts are browser-local and depend on the workstation being open and receiving new data; they are not a server-side always-on alert service.

## 3. Data provenance rules

The following distinctions are intentional and must remain visible in future changes:

1. **Tick-built candles:** underlying index/cash and configured MCX instrument candles are built from the ticks received by the existing Options Dashboard backend and stored by its candle writer.
2. **Sampled option observations:** option snapshots are captured about every 30 seconds. Aggregated option bars only describe observed samples; they do not claim the full market high/low between captures.
3. **Legacy option expiry:** older snapshots without expiry remain in the explicit unknown-expiry series. Never backfill expiry from a current instrument master.
4. **Crypto:** spot data/volume are tied to the selected exchange; Binance and OKX prices and volumes are not merged.
5. **Biquote:** the feed is indicative, provider-specific data. Forex/CFD volume is tick volume, and historical availability is rolling.
6. **Missing/stale data:** do not replace gaps or stale samples with synthetic flat prices. Report unavailable/disconnected/stale status instead.

## 4. Repositories and merged changes

- **ZaphodBeeblebrox12/Options-Dashboard:** PR #40 merged to main — chart live feeds, option-chain analytics and MCX candles. Its PR CI passed backend compile/unit tests, frontend typecheck/build, and replay/freshness regression tests.
- **ZaphodBeeblebrox12/chartinglibrary:** PR #7 merged to main — multi-market chart workstation, realtime providers, analytics, drawing manager and alert UI. Its PR CI passed TypeScript, unit tests, production build and all five Playwright browser smoke tests.
- A browser smoke-test fixture was corrected to provide the new option-chain API response; the frontend now also normalizes a missing/empty chain into a safe empty state.

CI validates code and mocked/test-data paths. The copied local SQLite database, actual Windows workstation, local backend-to-frontend websocket and real public exchange/provider network connections still require hands-on local verification.

## 5. Local integration gates still outstanding

These cannot be certified from GitHub Actions alone:

- Confirm the backend opens the intended copied SQLite database via TRADETHESIS_DB_PATH.
- Confirm the expiry migration is present and legacy rows stay unknown.
- Compare NIFTY/SENSEX sessions, timeframes and option history against the actual database.
- Confirm the existing backend /ws broadcasts committed candles and fresh option state into the chart without another Angel One session.
- Confirm configured cash/MCX tick subscriptions are active and have data.
- Confirm Binance, OKX and Biquote historical/live connectivity from the user's network/browser.
- Exercise grid layouts, saved workspaces, drawing tools, alerts and browser-notification permission in the local browser.

The full sequence is in [LOCAL_TEST_PLAN.md](LOCAL_TEST_PLAN.md).

## 6. Local run target

- Options Dashboard API: http://127.0.0.1:8000
- TradeThesis Charts: http://127.0.0.1:5173
- Shared database path example: C:/Projects/chartinglibrary/nifty_snapshots.db

Start the backend first, then run npm ci and npm run dev from the chart repository root. Keep broker credentials in the backend environment; never place them in frontend environment variables or source files.
