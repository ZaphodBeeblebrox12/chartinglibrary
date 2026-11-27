import type {
  Bar,
  BarsRequest,
  LiveBarMeta,
  UnsubscribeFn,
} from 'openalgo-charts'
import type { RealtimeProvider, RealtimeStatus } from './realtime'
import type { OptionMetrics } from './data'
import { istTimestampToUtcSeconds, parseOptionSymbol } from './data'

type LiveIndexState = {
  type?: string
  data?: {
    index_name?: string
    expiry?: string | null
    spot?: number | null
    timestamp?: string
    market_open?: boolean
    spot_age_sec?: number | null
    option_age_sec?: number | null
    options?: Array<{
      strike: number
      option_type: string
      ltp?: number | null
      source_updated_at?: string | null
      source_age_sec?: number | null
    }>
  }
}

type LiveCandleEvent = {
  type?: string
  data?: {
    symbol?: string
    ts_minute?: string
    open?: number
    high?: number
    low?: number
    close?: number
    volume?: number | null
    tick_count?: number
  }
}

function status(
  onStatus: (next: RealtimeStatus) => void,
  state: RealtimeStatus['state'],
  message?: string,
): void {
  onStatus({ state, ...(message ? { message } : {}), updatedAt: Date.now() })
}

function todayIST(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}

function istMinuteOfDay(timestamp: string): number | undefined {
  const match = / (\d{2}):(\d{2}):\d{2}$/.exec(timestamp)
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined
}

function bucketStart(
  timestamp: string,
  interval: string,
): { epoch: number; key: string } | undefined {
  const time = istMinuteOfDay(timestamp)
  const sourceEpoch = istTimestampToUtcSeconds(timestamp)
  if (time === undefined || sourceEpoch === undefined || time < 555 || time > 930) return undefined
  const minutesByInterval: Record<string, number> = {
    '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440,
  }
  const size = minutesByInterval[interval]
  if (!size) return undefined
  const offset = time - 555
  const startMinute = size === 1440 ? 555 : 555 + Math.floor(offset / size) * size
  const date = timestamp.slice(0, 10)
  const label = `${date} ${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}:00`
  const epoch = istTimestampToUtcSeconds(label)
  return epoch === undefined ? undefined : { epoch, key: label }
}

/**
 * Reuses the Options Dashboard's already-authenticated Angel One session.
 * The existing /ws broadcasts complete index option state; CandleBuilder
 * emits chart_candle only after each tick-built 1m candle has committed.
 * No broker credentials or duplicate broker WebSocket are created here.
 */
export class OptionsDashboardRealtimeProvider implements RealtimeProvider {
  constructor(
    private readonly getSelectedDate: () => string,
    private readonly onOptionMetrics?: (metrics: OptionMetrics) => void,
  ) {}

  subscribeBars(
    request: BarsRequest,
    onBar: (bar: Bar, meta?: LiveBarMeta) => void,
    onStatus: (next: RealtimeStatus) => void,
  ): UnsubscribeFn {
    const variantDate = request.variant?.unit?.split('|', 1)[0]
    const selectedDate = variantDate && /^\\d{4}-\\d{2}-\\d{2}$/.test(variantDate)
      ? variantDate
      : this.getSelectedDate()
    if (request.signal?.aborted) return () => undefined
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(selectedDate)) {
      status(onStatus, 'disconnected', 'Invalid selected session date')
      return () => undefined
    }
    if (selectedDate !== todayIST()) {
      status(onStatus, 'disconnected', 'Historical session selected; live stream paused')
      return () => undefined
    }
    if (typeof WebSocket === 'undefined') {
      status(onStatus, 'disconnected', 'WebSocket is unavailable in this browser')
      return () => undefined
    }

    const exchange = request.exchange.toUpperCase()
    const option = parseOptionSymbol(request.symbol)
    const instrument = option?.index ?? request.symbol.trim().toUpperCase()
    const isOption = option !== undefined || exchange === 'NFO' || exchange === 'BFO'
    if (isOption && !['NIFTY', 'SENSEX'].includes(instrument)) {
      status(onStatus, 'disconnected', 'Live option streaming is currently available for NIFTY and SENSEX only')
      return () => undefined
    }
    if (!isOption && !['NSE', 'BSE'].includes(exchange)) {
      status(onStatus, 'disconnected', 'No live cash-candle stream for this exchange')
      return () => undefined
    }
    if (isOption && (!option || option.expiry === 'UNKNOWN')) {
      status(onStatus, 'disconnected', 'Exact expiry identity is required for live option data')
      return () => undefined
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`
    let stopped = false
    let socket: WebSocket | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined
    let stableTimer: ReturnType<typeof setTimeout> | undefined
    let retryCount = 0
    let currentMinute: number | undefined
    let currentOptionBar: Bar | undefined
    let currentUnderlyingBucket: number | undefined
    let currentUnderlyingBar: Bar | undefined
    let lastRelevantAt = 0

    const emit = (bar: Bar) => {
      onBar(bar)
      lastRelevantAt = Date.now()
      status(onStatus, 'live')
    }

    const connect = () => {
      if (stopped) return
      status(onStatus, retryCount === 0 ? 'connecting' : 'reconnecting')
      try {
        socket = new WebSocket(url)
      } catch (error) {
        scheduleReconnect(error instanceof Error ? error.message : 'Local WebSocket could not start')
        return
      }

      socket.onopen = () => {
        if (stableTimer !== undefined) clearTimeout(stableTimer)
        stableTimer = setTimeout(() => {
          retryCount = 0
          stableTimer = undefined
        }, 30_000)
        if (pingTimer !== undefined) clearInterval(pingTimer)
        pingTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'ping' }))
          }
          if (lastRelevantAt && Date.now() - lastRelevantAt > 90_000) {
            status(onStatus, 'reconnecting', 'Waiting for fresh market data from Options Dashboard')
          }
        }, 25_000)
      }

      socket.onmessage = event => {
        if (typeof event.data !== 'string') return
        let message: LiveIndexState | LiveCandleEvent
        try {
          message = JSON.parse(event.data) as LiveIndexState | LiveCandleEvent
        } catch {
          return
        }

        if (message.type === 'chart_candle') {
          if (isOption) return
          const candle = (message as LiveCandleEvent).data
          if (!candle || candle.symbol?.toUpperCase() !== instrument || !candle.ts_minute) return
          if (!candle.ts_minute.startsWith(selectedDate)) return
          const bucket = bucketStart(candle.ts_minute, request.interval)
          if (!bucket) return
          const open = finite(candle.open)
          const high = finite(candle.high)
          const low = finite(candle.low)
          const close = finite(candle.close)
          if (open === undefined || high === undefined || low === undefined || close === undefined) return
          const volume = finite(candle.volume)

          if (currentUnderlyingBucket !== bucket.epoch || !currentUnderlyingBar) {
            currentUnderlyingBucket = bucket.epoch
            currentUnderlyingBar = {
              time: bucket.epoch, open, high, low, close,
              ...(volume === undefined ? {} : { volume }),
            }
          } else {
            currentUnderlyingBar.high = Math.max(currentUnderlyingBar.high, high)
            currentUnderlyingBar.low = Math.min(currentUnderlyingBar.low, low)
            currentUnderlyingBar.close = close
            if (volume !== undefined) currentUnderlyingBar.volume = (currentUnderlyingBar.volume ?? 0) + volume
          }
          emit({ ...currentUnderlyingBar })
          return
        }

        if (message.type !== 'tick') return
        const data = (message as LiveIndexState).data
        const stateInstrument = String(data?.index_name ?? data?.symbol ?? '').toUpperCase()
        if (!data || stateInstrument !== instrument) return

        if (isOption) {
          if (data.expiry !== option?.expiry) return
          const optionAge = finite(data.option_age_sec)
          if (optionAge !== undefined && optionAge > 90) {
            status(onStatus, 'reconnecting', `Option feed is stale (${Math.round(optionAge)}s)`)
            return
          }
          const point = data.options?.find(row =>
            Number(row.strike) === option.strike &&
            row.option_type.toUpperCase() === option.side,
          )
          const ltp = finite(point?.ltp)
          if (ltp === undefined || ltp <= 0) return
          const timestamp = point?.source_updated_at || data.timestamp
          if (!timestamp || !timestamp.startsWith(selectedDate)) return
          const sourceAge = finite(point?.source_age_sec)
          if (sourceAge !== undefined && sourceAge > 90) {
            status(onStatus, 'reconnecting', `Selected option sample is stale (${Math.round(sourceAge)}s)`)
            return
          }
          this.onOptionMetrics?.({
            timestamp,
            ltp,
            ...(finite(point?.oi) === undefined ? {} : { oi: finite(point?.oi) }),
            ...(finite(point?.oi_change) === undefined ? {} : { oiChange: finite(point?.oi_change) }),
            ...(finite(point?.volume) === undefined ? {} : { volume: finite(point?.volume) }),
            ...(finite(point?.iv) === undefined ? {} : { iv: finite(point?.iv) }),
            ...(finite(point?.delta) === undefined ? {} : { delta: finite(point?.delta) }),
            ...(finite(point?.gamma) === undefined ? {} : { gamma: finite(point?.gamma) }),
            ...(finite(point?.theta) === undefined ? {} : { theta: finite(point?.theta) }),
            ...(finite(point?.vega) === undefined ? {} : { vega: finite(point?.vega) }),
            ...(sourceAge === undefined ? {} : { sourceAgeSec: sourceAge }),
          })
          const time = istTimestampToUtcSeconds(timestamp)
          if (time === undefined) return
          const minute = Math.floor(time / 60) * 60
          if (currentMinute !== minute || !currentOptionBar) {
            currentMinute = minute
            currentOptionBar = { time: minute, open: ltp, high: ltp, low: ltp, close: ltp }
          } else {
            currentOptionBar.high = Math.max(currentOptionBar.high, ltp)
            currentOptionBar.low = Math.min(currentOptionBar.low, ltp)
            currentOptionBar.close = ltp
          }
          emit({ ...currentOptionBar })
          return
        }

        // Fallback spot updates keep the connection observable before the
        // first closed 1m candle; they are not emitted as candles, because the
        // authoritative candle stream is built from actual exchange ticks.
        const spot = finite(data.spot)
        const age = finite(data.spot_age_sec)
        if (spot !== undefined && age !== undefined && age <= 90) {
          this.onOptionMetrics?.({
            timestamp: data.timestamp || new Date().toISOString(),
            ltp: spot,
          })
          lastRelevantAt = Date.now()
          status(onStatus, 'live')
        }
      }

      socket.onerror = () => status(onStatus, 'reconnecting', 'Options Dashboard WebSocket error')
      socket.onclose = () => {
        if (pingTimer !== undefined) clearInterval(pingTimer)
        pingTimer = undefined
        if (stableTimer !== undefined) clearTimeout(stableTimer)
        stableTimer = undefined
        if (!stopped) scheduleReconnect('Options Dashboard WebSocket disconnected')
      }
    }

    const scheduleReconnect = (reason: string) => {
      if (stopped || retryTimer !== undefined) return
      status(onStatus, 'reconnecting', reason)
      const delay = Math.min(30_000, 1_000 * (2 ** Math.min(retryCount, 5)))
      retryCount += 1
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        connect()
      }, delay)
    }

    connect()
    return () => {
      stopped = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      if (pingTimer !== undefined) clearInterval(pingTimer)
      if (stableTimer !== undefined) clearTimeout(stableTimer)
      const current = socket
      socket = undefined
      if (current) {
        current.onclose = null
        current.onerror = null
        current.onmessage = null
        current.onopen = null
        current.close()
      }
      status(onStatus, 'disconnected')
    }
  }
}
