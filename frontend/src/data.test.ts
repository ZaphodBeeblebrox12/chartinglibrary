import { describe, expect, it } from 'vitest'
import type { OptionHistoryPoint } from './api'
import {
  createFixtureBars,
  istTimestampToUtcSeconds,
  mapCryptoCandles,
  mapOptionSnapshots,
  mapUnderlyingCandles,
  optionSymbol,
  parseOptionSymbol,
} from './data'

describe('IST timestamp conversion', () => {
  it('converts legacy wall-clock timestamps as Asia/Kolkata, not browser local time', () => {
    const actual = istTimestampToUtcSeconds('2026-09-11 09:15:30')
    const expected = Math.floor(Date.parse('2026-09-11T03:45:30Z') / 1000)
    expect(actual).toBe(expected)
  })

  it('respects an explicit timestamp offset', () => {
    const actual = istTimestampToUtcSeconds('2026-09-11T09:15:30+05:30')
    const expected = Math.floor(Date.parse('2026-09-11T03:45:30Z') / 1000)
    expect(actual).toBe(expected)
  })

  it('rejects invalid or empty input', () => {
    expect(istTimestampToUtcSeconds('')).toBeUndefined()
    expect(istTimestampToUtcSeconds('not-a-date')).toBeUndefined()
  })
})

describe('underlying candle mapping', () => {
  it('maps valid rows chronologically and leaves missing volume unknown', () => {
    const bars = mapUnderlyingCandles([
      { ts_minute: '2026-09-11 09:20:00', open: 2, high: 3, low: 1, close: 2.5, volume: null },
      { ts_minute: '2026-09-11 09:15:00', open: 1, high: 2, low: 0.5, close: 1.5, volume: null },
      { ts_minute: '2026-09-11 09:25:00', open: null as unknown as number, high: 3, low: 1, close: 2 },
    ])

    expect(bars).toHaveLength(2)
    expect(bars[0].close).toBe(1.5)
    expect(bars[0].volume).toBeUndefined()
    expect(bars[1].close).toBe(2.5)
  })
})

describe('option snapshot mapping', () => {
  const rows: OptionHistoryPoint[] = [
    {
      timestamp: '2026-09-11 09:15:00', option_type: 'CE', ltp: 100,
      oi: 1000, volume: 5000, volume_valid: true, iv: 14.1,
    },
    {
      timestamp: '2026-09-11 09:15:30', option_type: 'PE', ltp: 95,
      oi: 1100, volume: 5100, volume_valid: true,
    },
    {
      timestamp: '2026-09-11 09:15:30', option_type: 'CE', ltp: 101,
      oi: 1050, volume: 5125, volume_valid: true, iv: 14.3,
      delta: 0.51, gamma: 0.0004, theta: -3.2, vega: 5.1,
    },
    {
      timestamp: '2026-09-11 09:16:00', option_type: 'CE', ltp: 102,
      oi: 1075, volume: 8, volume_valid: true,
    },
    {
      timestamp: '2026-09-11 09:16:30', option_type: 'CE', ltp: 103,
      oi: 1080, volume: 40, volume_valid: false,
    },
    {
      timestamp: '2026-09-11 09:17:00', option_type: 'CE', ltp: 0,
      oi: 1090, volume: 70, volume_valid: true,
    },
  ]

  it('buckets 30-second LTP observations into one-minute sampled OHLC bars', () => {
    const result = mapOptionSnapshots(rows, 'CE')
    expect(result.observationCount).toBe(4)
    expect(result.bars).toHaveLength(2)
    expect(result.bars[0].time).toBe(istTimestampToUtcSeconds('2026-09-11 09:15:00'))
    expect(result.bars[0].open).toBe(100)
    expect(result.bars[0].high).toBe(101)
    expect(result.bars[0].low).toBe(100)
    expect(result.bars[0].close).toBe(101)
    expect(result.bars[1].open).toBe(102)
    expect(result.bars[1].high).toBe(103)
    expect(result.bars[1].close).toBe(103)
    expect(result.latest?.ltp).toBe(103)
    expect(result.latest?.iv).toBeUndefined()
  })

  it('derives cumulative volume deltas only across valid non-decreasing samples', () => {
    const result = mapOptionSnapshots(rows, 'CE')
    expect(result.bars[0].volume).toBe(125)
    expect(result.bars[1].volume).toBeUndefined()
  })
})

describe('option symbol identity', () => {
  it('round-trips an option symbol', () => {
    const symbol = optionSymbol('SENSEX', 82000, 'PE')
    expect(parseOptionSymbol(symbol)).toEqual({
      index: 'SENSEX',
      strike: 82000,
      side: 'PE',
    })
  })

  it('does not parse incomplete or non-option symbols', () => {
    expect(parseOptionSymbol('NIFTY')).toBeUndefined()
    expect(parseOptionSymbol('BANKNIFTY-50000-CE')).toBeUndefined()
  })

  it('keeps expiry in the option instrument identity', () => {
    const symbol = optionSymbol('NIFTY', 25000, 'CE', '26NOV2026')
    expect(symbol).toBe('NIFTY-25000-CE-26NOV2026')
    expect(parseOptionSymbol(symbol)).toEqual({
      index: 'NIFTY', strike: 25000, side: 'CE', expiry: '26NOV2026',
    })
  })
})

describe('crypto candle mapping', () => {
  it('maps exchange millisecond timestamps, volume and chronological order', () => {
    const bars = mapCryptoCandles([
      { time: 1795651260000, open: 90500, high: 91000, low: 90000, close: 90750, volume: 4.2 },
      { time: 1795651200000, open: 90000, high: 90500, low: 89500, close: 90500, volume: 5.1 },
    ])
    expect(bars).toHaveLength(2)
    expect(bars[0].time).toBe(1795651200)
    expect(bars[0].volume).toBe(5.1)
    expect(bars[1].close).toBe(90750)
  })
})

describe('demo feed fixtures', () => {
  it('is deterministic, session-bounded and clearly separate from live prices', () => {
    const first = createFixtureBars('NIFTY', '5m', '2026-09-11')
    const second = createFixtureBars('NIFTY', '5m', '2026-09-11')
    expect(first).toEqual(second)
    expect(first).toHaveLength(75)
    expect(first[0].time).toBe(istTimestampToUtcSeconds('2026-09-11 09:15:00'))
  })
})
