import type { Bar } from 'openalgo-charts'
import type {
  IndexName,
  OptionHistoryPoint,
  OptionSide,
  UnderlyingCandleRow,
  CryptoCandleRow,
} from './api'

export interface OptionMetrics {
  ltp?: number
  oi?: number
  oiChange?: number
  volume?: number
  iv?: number
  delta?: number
  gamma?: number
  theta?: number
  vega?: number
  gex?: number
  sourceAgeSec?: number
  sma20?: number
  ema20?: number
  rsi14?: number
  timestamp: string
}

export interface TechnicalMetrics {
  sma20?: number
  ema20?: number
  rsi14?: number
}

/**
 * Computes chart-native 20-bar SMA/EMA and 14-bar RSI from actual OHLC closes.
 * Bar counts depend on the selected interval; no wall-clock duration is implied.
 */
export function calculateTechnicalMetrics(bars: readonly Bar[]): TechnicalMetrics {
  const closes = bars
    .map(bar => Number(bar.close))
    .filter(value => Number.isFinite(value))
  if (!closes.length) return {}

  const result: TechnicalMetrics = {}
  if (closes.length >= 20) {
    const last20 = closes.slice(-20)
    result.sma20 = last20.reduce((sum, value) => sum + value, 0) / 20
    const k = 2 / 21
    let ema = closes.slice(0, 20).reduce((sum, value) => sum + value, 0) / 20
    for (const close of closes.slice(20)) ema = close * k + ema * (1 - k)
    result.ema20 = ema
  }

  if (closes.length >= 15) {
    let gains = 0
    let losses = 0
    for (let i = closes.length - 14; i < closes.length; i += 1) {
      const change = closes[i] - closes[i - 1]
      if (change > 0) gains += change
      else losses -= change
    }
    const averageGain = gains / 14
    const averageLoss = losses / 14
    result.rsi14 = averageLoss === 0
      ? averageGain === 0 ? 50 : 100
      : 100 - (100 / (1 + averageGain / averageLoss))
  }
  return result
}

export interface OptionBarsResult {
  bars: Bar[]
  latest?: OptionMetrics
  observationCount: number
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

/**
 * Options Dashboard timestamps are local IST wall-clock strings without an
 * offset. OpenAlgo Charts uses UTC epoch seconds, so the conversion happens
 * here at the data edge rather than relying on the browser timezone.
 */
export function istTimestampToUtcSeconds(value: string): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const hasZone = /(Z|[+-]\d{2}:\d{2})$/i.test(normalized)
  const parsed = Date.parse(hasZone ? normalized : `${normalized}+05:30`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined
}

export function mapCryptoCandles(rows: CryptoCandleRow[]): Bar[] {
  const byTime = new Map<number, Bar>()
  for (const row of rows) {
    const rawTime = finiteNumber(row.time)
    const time = rawTime === undefined ? undefined : Math.floor(rawTime > 1e12 ? rawTime / 1000 : rawTime)
    const open = finiteNumber(row.open)
    const high = finiteNumber(row.high)
    const low = finiteNumber(row.low)
    const close = finiteNumber(row.close)
    const volume = finiteNumber(row.volume)
    if (time === undefined || open === undefined || high === undefined || low === undefined || close === undefined) continue
    byTime.set(time, { time, open, high, low, close, ...(volume === undefined ? {} : { volume }) })
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

export function mapUnderlyingCandles(rows: UnderlyingCandleRow[]): Bar[] {
  const byTime = new Map<number, Bar>()

  for (const row of rows) {
    const time = istTimestampToUtcSeconds(row.ts_minute)
    const open = finiteNumber(row.open)
    const high = finiteNumber(row.high)
    const low = finiteNumber(row.low)
    const close = finiteNumber(row.close)
    if (
      time === undefined ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined
    ) {
      continue
    }

    const volume = finiteNumber(row.volume)
    byTime.set(time, {
      time,
      open,
      high,
      low,
      close,
      ...(volume === undefined ? {} : { volume }),
    })
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

/**
 * Option history is a sequence of sampled LTP observations, not exchange
 * OHLC. Every observation is represented as a flat bar so the widget can
 * plot its close as a line without inventing highs/lows between snapshots.
 * Cumulative volume is converted to a per-observation delta only across two
 * consecutive valid, non-decreasing readings.
 */
export function mapOptionSnapshots(
  rows: OptionHistoryPoint[],
  side: OptionSide,
): OptionBarsResult {
  const points = rows
    .filter((row) => row.option_type.toUpperCase() === side)
    .map((row) => ({
      row,
      time: istTimestampToUtcSeconds(row.timestamp),
      ltp: finiteNumber(row.ltp),
    }))
    .filter(
      (point): point is { row: OptionHistoryPoint; time: number; ltp: number } =>
        point.time !== undefined && point.ltp !== undefined && point.ltp > 0,
    )
    .sort((a, b) => a.time - b.time)

  // Snapshot rows arrive about every 30 seconds while the chart interval is
  // 1m. Bucket observations into one-minute bars so indicators measure
  // minutes, not half-minutes. OHLC is derived only from observed samples;
  // it is not claimed to be the exchange's true intraminute high/low.
  const byMinute = new Map<number, Bar>()
  let previousCumulativeVolume: number | undefined
  let latest: OptionMetrics | undefined

  for (const point of points) {
    const { row, time, ltp } = point
    const minute = Math.floor(time / 60) * 60
    const volume = finiteNumber(row.volume)
    let volumeDelta: number | undefined

    if (row.volume_valid === true && volume !== undefined && volume >= 0) {
      if (previousCumulativeVolume !== undefined && volume >= previousCumulativeVolume) {
        volumeDelta = volume - previousCumulativeVolume
      }
      previousCumulativeVolume = volume
    } else {
      previousCumulativeVolume = undefined
    }

    const oi = finiteNumber(row.oi)
    const existing = byMinute.get(minute)
    if (existing) {
      existing.high = Math.max(existing.high, ltp)
      existing.low = Math.min(existing.low, ltp)
      existing.close = ltp
      if (oi !== undefined) existing.oi = oi
      if (volumeDelta !== undefined) existing.volume = (existing.volume ?? 0) + volumeDelta
    } else {
      byMinute.set(minute, {
        time: minute,
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        ...(oi === undefined ? {} : { oi }),
        ...(volumeDelta === undefined ? {} : { volume: volumeDelta }),
      })
    }

    latest = {
      timestamp: row.timestamp,
      ltp,
      ...(oi === undefined ? {} : { oi }),
      ...(finiteNumber(row.oi_change) === undefined ? {} : { oiChange: finiteNumber(row.oi_change) }),
      ...(volume === undefined || row.volume_valid !== true ? {} : { volume }),
      ...(finiteNumber(row.iv) === undefined ? {} : { iv: finiteNumber(row.iv) }),
      ...(finiteNumber(row.delta) === undefined ? {} : { delta: finiteNumber(row.delta) }),
      ...(finiteNumber(row.gamma) === undefined ? {} : { gamma: finiteNumber(row.gamma) }),
      ...(finiteNumber(row.theta) === undefined ? {} : { theta: finiteNumber(row.theta) }),
      ...(finiteNumber(row.vega) === undefined ? {} : { vega: finiteNumber(row.vega) }),
      ...(finiteNumber(row.gex) === undefined ? {} : { gex: finiteNumber(row.gex) }),
      ...(finiteNumber(row.source_age_sec) === undefined ? {} : { sourceAgeSec: finiteNumber(row.source_age_sec) }),
    }
  }

  return {
    bars: [...byMinute.values()].sort((a, b) => a.time - b.time),
    latest,
    observationCount: points.length,
  }
}

export function createFixtureBars(
  symbol: string,
  interval: string,
  date: string,
  optionMode = false,
): Bar[] {
  const intervalSecondsByCode: Record<string, number> = {
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
  }
  const intervalSeconds = optionMode ? 30 : (intervalSecondsByCode[interval] ?? 300)
  const sessionStart = istTimestampToUtcSeconds(`${date} 09:15:00`)
  if (sessionStart === undefined) return []

  const sessionMinutes = 375
  const count = Math.floor((sessionMinutes * 60) / intervalSeconds)
  const base = optionMode
    ? symbol.startsWith('SENSEX') ? 185 : 115
    : symbol === 'SENSEX' ? 82000 : 26200
  let previousClose = base

  return Array.from({ length: count }, (_, index) => {
    const phase = index / 7
    const move = Math.sin(phase) * base * 0.0018 + Math.cos(phase * 0.37) * base * 0.0008
    const close = base + move + index * base * 0.000025
    const open = previousClose
    const spread = Math.max(base * 0.00045, Math.abs(close - open) * 0.7)
    const bar: Bar = {
      time: sessionStart + index * intervalSeconds,
      open: optionMode ? close : open,
      high: optionMode ? close : Math.max(open, close) + spread,
      low: optionMode ? close : Math.min(open, close) - spread,
      close,
    }
    previousClose = close
    return bar
  })
}

export function optionSymbol(
  index: IndexName,
  strike: number,
  side: OptionSide,
  expiry = 'UNKNOWN',
): string {
  // Expiry is part of contract identity, which also isolates drawings.
  return `${index}-${strike}-${side}-${expiry.toUpperCase()}`
}

export function parseOptionSymbol(
  symbol: string,
): { index: IndexName; strike: number; side: OptionSide; expiry?: string } | undefined {
  const match = /^(NIFTY|SENSEX)-(\d+)-(CE|PE)(?:-([A-Z0-9]+))?$/i.exec(symbol.trim())
  if (!match) return undefined
  return {
    index: match[1].toUpperCase() as IndexName,
    strike: Number(match[2]),
    side: match[3].toUpperCase() as OptionSide,
    ...(match[4] ? { expiry: match[4].toUpperCase() } : {}),
  }
}
