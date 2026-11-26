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

Required forward field: nullable `expiry`, written from the already-resolved capture `expiry_key`.

### Child `option_snapshots`

- `snapshot_id`
- `index_name`
- `strike`
- `option_type`
- `oi`, `oi_change`, `oi_change_pct`
- `volume`, `volume_valid`, `source_age_sec`
- `ltp`, `iv`, `delta`, `gamma`, `theta`, `vega`, `gex`

The option row inherits expiry from its parent snapshot. This preserves the existing one-row-per-snapshot/strike/side structure.

## 3. Proposed chart-history API

Proposed read-only endpoint in the Options Dashboard backend:

`GET /api/chart/options/history?index=NIFTY&expiry=11SEP2026&strike=25000&option_type=CE&from=2026-09-01&to=2026-09-11`

Response shape (illustrative contract; finalize against implementation):

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

## 4. Legacy history behavior

Before expiry persistence is added, historical rows have no reliable expiry identity in the database. They may be displayed as **Legacy / expiry unknown** with a date-scoped selection, but:
- do not infer their expiry from the current Scrip Master;
- do not combine history across expiry transition dates;
- do not describe the series as one exact option contract;
- do not backfill unless a separately archived, authoritative expiry record exists.

## 5. LTP and candle mapping

The source has sampled LTP, not trade-by-trade ticks.

- Preserve raw timestamped LTP observations.
- The most truthful default is a line chart.
- Snapshot-derived bars may group the observations in an interval, with open=first observed LTP, close=last observed LTP, high=max observed LTP and low=min observed LTP.
- Those high/low values are **sample extrema**, not true market OHLC.
- Empty buckets stay empty; do not forward-fill synthetic bars.
- Keep the source interval and aggregation semantics available to the UI.

## 6. Volume

Option-chain volume is cumulative traded volume for the session, not per-snapshot volume. A bar-volume delta may be calculated only when:
- current and previous rows are marked valid;
- both belong to the same date and exact contract identity;
- both cumulative values are numeric;
- current volume is greater than or equal to previous volume.

On a reset, invalid sample or missing previous reading, do not invent a zero. Expose null/unknown and allow the UI to show a gap.

## 7. OI, IV and Greeks

OI, IV, Delta, Gamma, Theta, Vega and GEX are observations over time. Keep them as separate sampled series / lower panes. Do not run them through OHLC aggregation as if they were traded prices.

Null, stale or invalid values remain null; do not draw fabricated continuity through missing readings unless a user explicitly enables a visual interpolation mode.

## 8. Time handling

The existing timestamps are formatted as local wall-clock strings. Interpret them as Asia/Kolkata for the initial NSE/BSE implementation, then convert to the chart library's time representation carefully. Add tests around session open, date rollover, expiry day and browser timezone differing from IST.

## 9. Status metadata

Every chart data response should expose:
- source (database snapshots vs another source);
- sample cadence / observed timestamp range;
- expiry known or unknown;
- last observation timestamp;
- gaps/staleness;
- whether bar values are snapshot-derived.
