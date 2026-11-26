# Local verification plan

This checklist is for the first local integration test after the chart frontend, Options Dashboard backend and copied SQLite database are in place.

## 1. Confirm the shared SQLite database path

The chart reads underlying candles and option snapshots through the Options Dashboard backend. It does not open SQLite from the browser.

In Options-Dashboard/backend/.env, keep the existing environment variables and add the absolute path to the copied database:

    TRADETHESIS_DB_PATH=C:/Projects/chartinglibrary/nifty_snapshots.db

The backend loads this .env before importing the database module. On startup, verify that its database initialization log points to this exact path.

**SQLite copy safety:** if the source backend was running while the database was copied, stop it and make a fresh copy before testing. With SQLite WAL mode, a committed write can still be in the -wal file until checkpointed. Do not delete -wal or -shm files manually while a database is in use.

## 2. Pull the latest code and install

From PowerShell:

    cd C:\Projects\Options-Dashboard
    git pull origin main

    cd C:\Projects\chartinglibrary
    git pull origin main
    npm ci

Use Node.js 26.13.1 (or Node.js 24 or newer).

## 3. Start both applications

Terminal 1 — backend:

    cd C:\Projects\Options-Dashboard\backend
    .\.venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    python main.py

Terminal 2 — chart:

    cd C:\Projects\chartinglibrary
    npm run dev

Open http://127.0.0.1:5173. Keep both terminals running.

## 4. Verify NIFTY and SENSEX history

- Select NIFTY and confirm the saved-session count is plausible.
- Select a known date with data (for example, 26 November 2026) and compare candle timestamps with the Options Dashboard.
- Switch between 5m, 15m, 30m and 1h.
- Change the date twice and confirm the chart only shows the selected session; no later session should be relabelled as the earlier date.
- Repeat for SENSEX.
- Confirm the chart status identifies the source as saved underlying candles and does not claim cash-index volume is available.

## 5. Verify option history

- Select Call, then Put.
- Confirm expiry choices are those actually saved for the selected date.
- Change expiry and confirm the strike list changes to the selected expiry's available strikes.
- Change strike and confirm the historical premium series changes.
- Check that the chart heading identifies the contract and expiry.
- For legacy rows, verify the UI labels expiry as unknown rather than inferring an expiry.
- Confirm the status mentions sampled one-minute bars, capture age and any detected gaps.
- Switch date/expiry/strike and confirm old contract metrics do not remain visible.

## 6. Verify BTC/USDT

- Select BTC, then Binance.
- Confirm historical candles load for the selected UTC date and volume is present.
- Select Today and check whether the live stream changes status to connected after the first incoming candle update.
- Switch to OKX and verify the displayed exchange label and price series change; never compare an OKX series while the UI still says Binance.
- For OKX, check that the live status remains connected through at least one heartbeat interval.
- Change to a prior UTC date and confirm the live stream is paused while historical candles remain visible.
- Compare the two exchange charts only as venue-specific prices and volumes; small differences are expected.

No exchange API key is needed for these public spot market-data endpoints.

## 7. Capture results if a check fails

Record the exact selected market, exchange, date, timeframe and expiry/strike (for options), plus the backend terminal error and browser console error. Do not share API keys, passwords, TOTP secrets or the SQLite database itself in a screenshot.

## Expected test boundary

GitHub Actions already checks TypeScript, unit tests, production build and Playwright browser smoke flows with mocked APIs. This checklist verifies the real local SQLite file, the user's Windows environment and actual exchange WebSocket connectivity; those cannot be certified by CI alone.
