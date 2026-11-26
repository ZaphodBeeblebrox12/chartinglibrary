export type IndexName = 'NIFTY' | 'SENSEX'
export type OptionSide = 'CE' | 'PE'
export type CryptoExchange = 'BINANCE' | 'OKX'

export interface CryptoCandleRow {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

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
  expiry?: string | null
  expiry_known?: boolean
  spot?: number | null
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

export interface OptionHistoryResponse {
  points: OptionHistoryPoint[]
  quality?: {
    gaps_detected?: boolean
    last_timestamp?: string | null
    missing_expiry_rows?: number
    migration_missing?: boolean
  }
  sampling?: {
    expected_seconds?: number
    bar_semantics?: string
  }
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
  expiry: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const params = new URLSearchParams({ index, date, expiry })
  const payload = await getJson<{ strikes?: number[] }>(
    `/api/chart/options/strikes?${params.toString()}`,
    signal,
  )
  return Array.isArray(payload.strikes)
    ? payload.strikes.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    : []
}

export interface OptionExpiryChoices {
  expiries: string[]
  hasUnknown: boolean
  unknownSnapshotCount: number
}

export async function fetchAvailableExpiries(
  index: IndexName,
  date: string,
  signal?: AbortSignal,
): Promise<OptionExpiryChoices> {
  const params = new URLSearchParams({ index, date })
  const payload = await getJson<{
    expiries?: string[]
    unknown_snapshot_count?: number
  }>(`/api/chart/options/expiries?${params.toString()}`, signal)
  const expiries = Array.isArray(payload.expiries) ? payload.expiries : []
  const unknownSnapshotCount = Number(payload.unknown_snapshot_count ?? 0)
  return {
    expiries,
    hasUnknown: unknownSnapshotCount > 0,
    unknownSnapshotCount: Number.isFinite(unknownSnapshotCount) ? unknownSnapshotCount : 0,
  }
}

export async function fetchOptionHistory(
  index: IndexName,
  strike: number,
  side: OptionSide,
  expiry: string,
  date: string,
  signal?: AbortSignal,
): Promise<OptionHistoryResponse> {
  const params = new URLSearchParams({
    index,
    strike: String(strike),
    option_type: side,
    expiry,
    date,
  })
  const payload = await getJson<OptionHistoryResponse>(
    `/api/chart/options/history?${params.toString()}`,
    signal,
  )
  return {
    ...payload,
    points: Array.isArray(payload.points) ? payload.points : [],
  }
}
