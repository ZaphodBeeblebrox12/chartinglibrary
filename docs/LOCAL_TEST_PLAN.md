# TradeThesis Charts — local integration test plan

This checklist verifies the merged frontend, the companion Options Dashboard backend, the copied SQLite database and real network feeds. GitHub CI already covers code-level checks with deterministic fixtures/mocked API responses; these steps validate the actual Windows workstation.

## 1. Confirm the shared SQLite database path

The browser never opens SQLite directly. The chart frontend calls the Options Dashboard FastAPI backend, which must open the copied database.

In Options-Dashboard/backend/.env, keep the existing variables and set the absolute path to the copied database if it is not already configured:

        TRADETHESIS_DB_PATH=C:/Projects/chartinglibrary/nifty_snapshots.db

On backend startup, confirm the database initialization log points to this exact file.

**SQLite copy safety:** if the source backend was running while the database was copied, stop it and make a fresh consistent copy before testing. With SQLite WAL mode, committed writes can remain in the -wal file until checkpointed. Never manually delete -wal or -shm files while a backend is using the database.

## 2. Pull both merged repositories and install

From PowerShell:

        cd C:\Projects\Options-Dashboard
        git pull origin main

        cd C:\Projects\chartinglibrary
        git pull origin main
        npm ci

Use Node.js 26.13.1 (Node.js 24 or newer is required).

## 3. Start both applications

Terminal 1 — backend:

        cd C:\Projects\Options-Dashboard\backend
        .\.venv\Scripts\Activate.ps1
        pip install -r requirements.txt
        python main.py

Terminal 2 — chart frontend:

        cd C:\Projects\chartinglibrary
        npm run dev

Open http://127.0.0.1:5173 and keep both terminals running.

## 4. Verify NIFTY and SENSEX underlying history

For each index:

- Confirm the saved-session count is plausible for the copied database.
- Select known dates with saved candles (26 November 2026 is one example if that date exists in your copy).
- Compare candle timestamps and OHLC values with the Options Dashboard.
- Switch through 1m, 5m, 15m, 30m, 1h, 4h and 1d where supported.
- Change the date more than once. Confirm that only the selected session appears and a later session is never relabelled as an earlier date.
- Confirm the chart source identifies tick-built underlying candles and does not invent cash-index volume.
- Repeat the checks for both NIFTY and SENSEX.

## 5. Verify expiry-aware CE/PE option history and chain analytics

- Select Call and Put separately.
- Confirm the expiry selector lists expiries actually saved for the selected index/date.
- Change expiry and confirm the strike list is scoped to that expiry.
- Change strike and confirm the selected premium series changes.
- Confirm the heading shows index, strike, side and expiry.
- Verify legacy records appear only as **Legacy / expiry unknown**, never silently assigned a current expiry.
- Check that the selected chain analytics match the latest saved snapshot for the same date and expiry: CE/PE OI rows, call/put walls, stored max pain, gamma flip and GEX.
- If max pain is estimated from OI because the snapshot did not save it, confirm the estimate caveat is shown.
- Confirm the OI profile and CE/PE comparison are empty/clearly unavailable when no chain rows exist.
- Check historical spot, premium, OI, OI change, IV, Delta, Gamma, Theta, Vega and GEX sparklines where samples exist.
- Confirm the premium chart explicitly identifies sampled observations / approximately 30-second capture cadence. Its sample-derived high/low must not be mistaken for complete tick OHLC.
- Change date, expiry, strike and side and confirm old contract metrics do not remain visible.

## 6. Verify Indian live feed reuse (no second broker connection)

During an active market session, with the Options Dashboard's existing live feed running:

- Open an underlying NIFTY chart and check that new committed chart_candle updates arrive over the existing backend /ws.
- Repeat for SENSEX.
- Select an exact-expiry option and confirm fresh option LTP and option metrics update for the selected index, expiry, strike and CE/PE side.
- Confirm stale option samples are not treated as fresh; inspect the status text when the source age is above its allowed threshold.
- Select an older historical session and confirm live updates are paused for that historical date.
- Confirm the chart does not create another Angel One login, new SmartAPI session or independent broker WebSocket.

## 7. Verify configured cash equities and MCX futures

These selectors show instruments configured/tracked by the Options Dashboard; they are not an unrestricted exchange-wide symbol search.

- Check that the instrument selector reflects the backend's configured instrument list.
- Select a configured NSE cash equity and confirm its historical candles, exchange label and tick-built source label.
- During market hours, confirm the active backend stream produces new saved/live cash candles for that symbol.
- Select a configured MCX front-month FUTCOM instrument and confirm it is described as a futures contract, not a spot commodity price.
- Verify the MCX session start/close behaviour for that symbol and selected timeframe.
- Confirm missing configuration or missing candle history is reported as unavailable/empty, not replaced with synthetic prices.

## 8. Verify Bitcoin spot — Binance and OKX

- Select BTC and Binance. Confirm historical BTC/USDT candles load for the selected UTC date, with exchange-reported spot volume.
- Select the current UTC date and check that the Binance public candle stream becomes live after receiving updates.
- Switch to OKX and confirm the exchange label and series both change to OKX.
- Check that the OKX connection stays live through multiple heartbeat intervals.
- Select an older UTC date and confirm the live subscription pauses while historical candles remain visible.
- Compare Binance and OKX only as separate venue-specific markets; do not expect identical price or volume.
- No exchange API key is required for these public market-data endpoints.

## 9. Verify Biquote global markets

- Select GLOBAL and confirm the public symbol catalogue loads.
- Change asset class across Forex, Metals/Energy, Crypto, Indices and Stocks/CFDs.
- Search symbols and select a provider-listed instrument.
- Confirm historical candles are requested for the selected UTC date and timeframe.
- For the current UTC date, check whether the Biquote SignalR feed connects and delivers candle updates.
- Select an older date and confirm the live subscription pauses.
- Confirm the UI describes prices as Biquote indicative provider data, not guaranteed executable quotes.
- Treat volume as provider tick volume, not exchange-traded volume.
- If the public catalogue, historical endpoint, browser connection or provider stream is blocked/unavailable, verify that the app reports the failure and does not substitute fabricated prices. Biquote availability/retention is provider-dependent.

## 10. Verify chart workstation, layouts and persistence

- Switch through 1x1, 1x2, 2x1, 2x2, 2x3 and 3x2 layouts.
- Confirm the chart cells render and linked crosshairs/viewports follow the grid's synchronization settings.
- Switch the active chart cell and confirm the market, exchange, symbol, timeframe and session selectors reflect the active chart.
- Save a named workspace, change symbols/layout/theme, then reload the saved workspace.
- Refresh the browser and confirm the saved chart context/grid/drawings restore as expected.
- Confirm light and dark themes render correctly in the application shell and chart controls.

## 11. Verify drawings, technical metrics and alerts

- Open the drawing tool catalogue and arm common tools: trend line, ray, horizontal line, rectangle and Fibonacci retracement.
- Add/remove drawing favorites and test magnet modes.
- Test undo, redo, eraser, cursor, object selection, hide/show, lock/unlock, deletion and grouping.
- Confirm saved drawings persist after refresh and that switching instruments respects the configured instrument drawing scope.
- Confirm SMA20, EMA20 and RSI14 are calculated from actual loaded/live bar closes; values should be absent until enough bars exist.
- Create a price or option-metric alert, confirm it is stored for the current browser, then feed/observe a threshold crossing.
- Confirm the rule triggers once and can be re-armed; check Pause/Resume and Remove.
- Browser notifications are optional and require explicit browser permission. In-app alert state should still function without notification permission.
- Alerts are browser-local and only process when the workstation is open and receiving fresh data; they are not a server-side always-on monitoring system.

## 12. If a check fails

Record the exact market, symbol, exchange, date, timeframe and (for options) expiry/strike/side. Capture the browser console error and relevant backend terminal log. Do not include API keys, passwords, JWTs, TOTP secrets or the SQLite database in screenshots or shared logs.

Useful commands:

        npm run check
        npm run test:e2e

## Expected verification boundary

The chart PR CI passed TypeScript, unit tests, production build and all five Playwright browser smoke tests. The Options Dashboard PR CI passed backend compilation/unit tests, frontend typecheck/build and replay/freshness regression tests.

Those automated tests do not connect to your copied SQLite file, Windows environment, live Angel One session, Binance/OKX sockets or Biquote provider. The checks above are still required before declaring the complete local integration verified.
