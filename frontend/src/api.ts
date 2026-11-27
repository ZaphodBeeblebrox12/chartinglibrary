export type IndexName = 'NIFTY' | 'SENSEX'
export type OptionSide = 'CE' | 'PE'
export type CryptoExchange = 'BINANCE' | 'OKX'

export interface TrackedCashInstrument {
  name: string
  kind: 'STOCK' | 'COMMODITY'
  tier: number
  exchange: 'NSE' | 'MCX'
}

export type GlobalAssetType = 'Forex' | 'Stock' | 'Crypto' | 'Index' | 'Commodity'

export interface GlobalMarketInstrument {
  name: string
  description: string
  type: GlobalAssetType
  exchange: string
  source: string
}

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

export interface OptionChainStrike {
  strike: number
  CE: OptionChainSide | null
  PE: OptionChainSide | null
}

export interface OptionChainSide {
  oi?: number | null
  oi_change?: number | null
  oi_change_pct?: number | null
  volume?: number | null
  volume_valid?: boolean
  source_age_sec?: number | null
  ltp?: number | null
  iv?: number | null
  delta?: number | null
  gamma?: number | null
  theta?: number | null
  vega?: number | null
  gex?: number | null
}

export interface OptionChainResponse {
  index_name: IndexName
  date: string
  expiry: string | null
  expiry_known?: boolean
  asof: string | null
  spot: number | null
  strikes: OptionChainStrike[]
  analytics: {
    call_wall?: number | null
    put_wall?: number | null
    max_pain?: number | null
    gamma_flip?: number | null
    max_gex_strike?: number | null
    net_gex?: number | null
    max_pain_source?: string | null
  }
  quality?: {
    snapshot_rows?: number
    missing_ce_pairs?: number
    missing_pe_pairs?: number
    legacy_expiry?: boolean
    empty?: boolean
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
  index: string,
  interval: string,
  date: string,
  signal?: AbortSignal,
): Promise<UnderlyingCandleRow[]> {
  const apiInterval = ({ '1h': '1H', '4h': '4H', '1d': '1D' } as Record<string, string>)[interval] ?? interval
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

export async function fetchCryptoCandles(
  exchange: CryptoExchange,
  interval: string,
  date: string,
  signal?: AbortSignal,
): Promise<CryptoCandleRow[]> {
  const params = new URLSearchParams({ exchange, interval, date })
  const payload = await getJson<{ candles?: CryptoCandleRow[] }>(
    `/api/chart/crypto/candles?${params.toString()}`,
    signal,
  )
  return Array.isArray(payload.candles) ? payload.candles : []
}

export async function fetchOptionChain(
  index: IndexName,
  expiry: string,
  date: string,
  signal?: AbortSignal,
): Promise<OptionChainResponse> {
  const params = new URLSearchParams({ index, expiry, date })
  return getJson<OptionChainResponse>(
    `/api/chart/options/chain?${params.toString()}`,
    signal,
  )
}

export async function fetchTrackedCashInstruments(
  signal?: AbortSignal,
): Promise<TrackedCashInstrument[]> {
  const payload = await getJson<{
    instruments?: Array<{ name?: string; kind?: string; tier?: number; exchange?: string }>
  }>('/api/instruments', signal)
  if (!Array.isArray(payload.instruments)) return []
  return payload.instruments
    .filter(item => item.name && ['stock', 'commodity'].includes((item.kind ?? '').toLowerCase()))
    .map(item => {
      const kind = String(item.kind ?? 'stock').toUpperCase() as 'STOCK' | 'COMMODITY'
      return {
        name: String(item.name).toUpperCase(),
        kind,
        tier: Number(item.tier ?? 2),
        exchange: (kind === 'COMMODITY' ? 'MCX' : 'NSE') as 'NSE' | 'MCX',
      }
    })
    .filter((item, index, all) => all.findIndex(other => other.name === item.name) === index)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchGlobalMarketInstruments(
  signal?: AbortSignal,
): Promise<GlobalMarketInstrument[]> {
  const response = await fetch(
    'https://biquote.io/api/symbols?quotedWithinDays=7',
    { headers: { Accept: 'application/json' }, signal },
  )
  if (!response.ok) {
    throw new Error(`Global market catalogue returned HTTP ${response.status}`)
  }
  const payload = await response.json() as unknown
  const rows = Array.isArray(payload)
    ? payload
    : ((payload as { symbols?: unknown[]; items?: unknown[]; data?: unknown[] })?.symbols ??
       (payload as { items?: unknown[] })?.items ??
       (payload as { data?: unknown[] })?.data ?? [])
  if (!Array.isArray(rows)) return []
  const supported = new Set<GlobalAssetType>(['Forex', 'Stock', 'Crypto', 'Index', 'Commodity'])
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    const name = String(row.name ?? row.symbol ?? '').trim().toUpperCase()
    const type = String(row.type ?? '').trim() as GlobalAssetType
    if (!name || !supported.has(type)) return []
    return [{
      name,
      description: String(row.description ?? name),
      type,
      exchange: String(row.exchange ?? row.source ?? 'Biquote'),
      source: String(row.source ?? 'MT5'),
    }]
  }).filter((item, index, all) =>
    all.findIndex(other => other.name === item.name) === index,
  ).sort((a, b) => a.name.localeCompare(b.name))
}
