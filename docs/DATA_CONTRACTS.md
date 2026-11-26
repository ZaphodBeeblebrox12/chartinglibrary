# Data Contracts and Quality Rules

## 1. Canonical option instrument identity

A charted option must be identified by:

`exchange + underlying + expiry + strike + option_type`

For the initial indices:
- exchange: NSE or BSE (confirm actual index exchange mapping from the instrument master)
- underlying: NIFTY or SENSEX
- expiry: explicit expiry key, e.g. `11SEP2026`
- strike: integer strike
- option_type: CE or PE

Never treat `underlying + strike + option_type` as a complete long-term identity. Expiry changes the contract.

## 2. Existing stored fields

### Parent `snapshots`

- `id`
- `timestamp`
- `index_name`
- `spot`
- `futures`
- `futures_oi`
- `futures_spread`
- `net_gex`
- `max_gex_strike`
- `max_pain`
- `gamma_flip)

Nullable `expiry`, added by a backward-compatible migration and written from the already-resolved capture `expiry_key`. Existing rows remain `NULL`.

### Child `option_snapshots`

- `snapshot_id`
- `index_name`
- `strike`
- `option_type`
- `oi`, `oi_change`, `oi_change_pct`
- `volume`, `volume_valid`, `source_age_sec`
- `ltp`, `iv`, `delta`, `gamma`, `theta`, `vega`, `gex`

The option row inherits expiry from its parent snapshot. This preserves the existing one-row-per-snapshot/strike/side structure.

## 3. Existing underlying OHLC contract

The current Options Dashboard already persists one-minute OHLC for underlying CASH/spot ticks:

`candles_1m(symbol, ts_minute, open, high, low, close, volume, tick_count, finalized_at)`

The NIFTY/SENSEX spot-tick handlers call the shared `CandleBuilder`; configured STOCK-kind cash streams do the same. The builder aggregates actual incoming ticks and prefers the Angel exchange timestamp when valid. For the index CASH/spot tick mode, `volume` is currently NULL because those ticks do not carry LTQ.

The existing `GET /api/scanner/candles?symbol=NIFTY|SENSEX&tf=5m|15m|30m|1H&date=YYYY-MM-DD` endpoint derives higher timeframes from stored 1m candles. TradeThesis Charts should reuse this source for NIFTY/SENSEX underlying charts. Add a small read-only 1m history endpoint only if the existing scanner endpoint's time-range contract proves insufficient.

**Scope boundary:** this table is for underlying/cash candles. It does not store individual option contract candles.

## 4. Implemented option chart-history API

The Options Dashboard backend exposes two read-only endpoints:

- `GET /api/chart/options/expiries?index=NIFTY&date=2026-11-26` lists expiries actually persisted for that index/session and separately reports the count of snapshots whose expiry is unknown.
- `GET /api/chart/options/history?index=NIFTY&expiry=26NOV2026&strike=25000&option_type=CE&date=2026-11-26` returns one date, exact expiry, strike and side. Use `expiry=UNKNOWN` to query legacy rows whose parent snapshot has `expiry IS NULL`.

The history response contains `instrument`, `sampling`, `points` and `quality`. `instrument.expiry_known` is false for the legacy selector. Each point inherits expiry and spot from its parent snapshot. The query first selects parent snapshot IDs using `(index_name, expiry, timestamp)`, then reads only the selected strike and option type. SQLite work runs through `asyncio.to_thread`.

The response shape is:

```json
{
  "instrument": {
    "exchange": "NSE",
    "underlying": "NIFTY",
    "expiry": "11SEP2026",
    "strike": 25000,
    "option_type": "CE"
  },
  "sampling": {
    "source": "option_chain_snapshots",
    "expected_seconds": 30,
    "bar_semantics": "sampled_observations"
  },
  "points": [
    {
      "timestamp": "2026-09-11T09:15:30+05:30",
      "ltp": 123.45,
      "oi": 123456,
      "oi_change": 2300,
      "volume": 12000,
      "volume_valid": true,
      "iv": 14.2,
      "delta": 0.51,
      "gamma": 0.0008,
      "theta": -4.2,
      "vega": 7.1,
      "gex": 1234567,
      "spot": 25012.5,
      "expiry_known": true
    }
  ],
  "quality": {
    "missing_expiry_rows": 0,
    "gaps_detected": false
  }
}
```

The endpoint should be paginated or date-bounded, use indexed queries, run blocking SQLite reads off the FastAPI event loop, and return chronological points. The response must not include credentials or broker tokens.

## 5. Legacy history behavior

Historical rows created before expiry persistence have no reliable expiry identity in the database. They may be displayed as **Legacy / expiry unknown** with a date-scoped selection, but:
- do not infer their expiry from the current Scrip Master;
- do not combine history across expiry transition dates;
- do not describe the series as one exact option contract;
- do not backfill unless a separately archived, authoritative expiry record exists.

## 6. LTP and candle mapping

The source has sampled LTP, not trade-by-trade ticks.

- Preserve raw timestamped LTP observations.
- The most truthful default is a line chart.
- Snapshot-derived bars may group the observations in an interval, with open=first observed LTP, close=last observed LTP, high=max observed LTP and low=min observed LTP.
- Those high/low values are **sample extrema**, not true market OHLC.
- Empty buckets stay empty; do not forward-fill synthetic bars.
- Keep the source interval and aggregation semantics available to the UI.

## 7. Volume

Option-chain volume is cumulative traded volume for the session, not per-snapshot volume. A bar-volume delta may be calculated only when:
- current and previous rows are marked valid;
- both belong to the same date and exact contract identity;
- both cumulative values are numeric;
- current volume is greater than or equal to previous volume.

On a reset, invalid sample or missing previous reading, do not invent a zero. Expose null/unknown and allow the UI to show a gap.

## 8. OI, IV and Greeks

OI, IV, Delta, Gamma, Theta, Vega and GEX are observations over time. Keep them as separate sampled series / lower panes. Do not run them through OHLC aggregation as if they were traded prices.

Null, stale or invalid values remain null; do not draw fabricated continuity through missing readings unless a user explicitly enables a visual interpolation mode.

## 9. Time handling

The existing timestamps are formatted as local wall-clock strings. Interpret them as Asia/Kolkata for the initial NSE/BSE implementation, then convert to the chart library's time representation carefully. Add tests around session open, date rollover, expiry day and browser timezone differing from IST.

## 10. Status metadata

Every chart data response should expose:
- source (database snapshots vs another source);
- sample cadence / observed timestamp range;
- expiry known or unknown;
- last observation timestamp;
- gaps/staleness;
- whether bar values are snapshot-derived.
