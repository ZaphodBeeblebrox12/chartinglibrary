export type IndexName = 'NIFTY' | 'SENSEX'
export type OptionSide = 'CE' | 'PE'

export interface UnderlyingCandleRow {
  symbol?: string
  ts_minute: string
  open: number
  high: number
  low: number
  close: number
  volume?: number | null
  tick_count?: number | null
}

export interface OptionHistoryPoint {
  timestamp: string
  option_type: string
  ltp?: number | null
  oi?: number | null
  oi_change?: number | null
  oi_change_pct?: number | null
  volume?: number | null
  volume_valid?: boolean
  source_age_sec?: number | null
  iv?: number | null
  delta?: number | null
  gamma?: number | null
  theta?: number | null
  vega?: number | null
  gex?: number | null
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Options Dashboard API returned ${response.status} for ${path}`)
  }

  return response.json() as Promise<T>
}

export async function fetchAvailableDates(
  index: IndexName,
  signal?: AbortSignal,
): Promise<string[]> {
  const params = new URLSearchParams({ index })
  const payload = await getJson<{ dates?: string[] }>(
    `/api/available-dates?${params.toString()}`,
    signal,
  )
  return Array.isArray(payload.dates) ? payload.dates : []
}

export async function fetchUnderlyingCandles(
  index: IndexName,
  interval: string,
  date: string,
  signal?: AbortSignal,
): Promise<UnderlyingCandleRow[]> {
  const apiInterval = interval === '1h' ? '1H' : interval
  const params = new URLSearchParams({
    symbol: index,
    tf: apiInterval,
    date,
  })
  const payload = await getJson<{ candles?: UnderlyingCandleRow[] }>(
    `/api/scanner/candles?${params.toString()}`,
    signal,
  )
  return Array.isArray(payload.candles) ? payload.candles : []
}

export async function fetchStrikesForDate(
  index: IndexName,
  date: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const params = new URLSearchParams({ index, date })
  const snapshotPayload = await getJson<{ timestamps?: string[] }>(
    `/api/snapshots?${params.toString()}`,
    signal,
  )
  const timestamps = Array.isArray(snapshotPayload.timestamps)
    ? snapshotPayload.timestamps
    : []

  const latestTimestamp = timestamps[timestamps.length - 1]
  if (!latestTimestamp) return []

  const strikeParams = new URLSearchParams({
    index,
    timestamp: latestTimestamp,
  })
  const strikePayload = await getJson<{ strikes?: number[] }>(
    `/api/strikes?${strikeParams.toString()}`,
    signal,
  )

  return Array.isArray(strikePayload.strikes)
    ? strikePayload.strikes.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    : []
}

export async function fetchOptionHistory(
  index: IndexName,
  strike: number,
  date: string,
  signal?: AbortSignal,
): Promise<OptionHistoryPoint[]> {
  const params = new URLSearchParams({ index, date })
  const payload = await getJson<{ timeseries?: OptionHistoryPoint[] }>(
    `/api/history/${encodeURIComponent(String(strike))}?${params.toString()}`,
    signal,
  )
  return Array.isArray(payload.timeseries) ? payload.timeseries : []
}
