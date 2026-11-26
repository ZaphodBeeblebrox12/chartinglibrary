import type {
  Bar,
  BarsRequest,
  LiveBarMeta,
  UnsubscribeFn,
} from 'openalgo-charts'
import type { CryptoExchange } from './api'
import type { RealtimeStatus } from './realtime'

const BINANCE_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'])
const OKX_CHANNELS: Record<string, string> = {
  '1m': 'candle1m',
  '3m': 'candle3m',
  '5m': 'candle5m',
  '15m': 'candle15m',
  '30m': 'candle30m',
  '1h': 'candle1H',
  '2h': 'candle2H',
  '4h': 'candle4H',
  '1d': 'candle1Dutc',
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

function noSubscription(): UnsubscribeFn {
  return () => undefined
}

function status(
  notify: (next: RealtimeStatus) => void,
  state: RealtimeStatus['state'],
  message?: string,
): void {
  notify({ state, ...(message ? { message } : {}), updatedAt: Date.now() })
}

/**
 * Public BTC/USDT spot kline subscription. No API key is used. The exchange
 * sends its own OHLCV updates; we do not fabricate trades or extrapolate bars.
 * Old selected UTC dates remain historical-only.
 */
export function subscribeCryptoBars(
  exchange: CryptoExchange,
  request: BarsRequest,
  selectedDate: string,
  onBar: (bar: Bar, meta?: LiveBarMeta) => void,
  onStatus: (next: RealtimeStatus) => void,
): UnsubscribeFn {
  if (selectedDate !== todayUTC()) {
    status(onStatus, 'disconnected', 'Historical date selected; live stream paused')
    return noSubscription()
  }

  if (typeof WebSocket === 'undefined') {
    status(onStatus, 'disconnected', 'WebSocket is unavailable in this browser')
    return noSubscription()
  }

  const interval = request.interval
  if (exchange === 'BINANCE' && !BINANCE_INTERVALS.has(interval)) {
    status(onStatus, 'disconnected', `Binance does not stream the ${interval} interval`)
    return noSubscription()
  }
  const channel = OKX_CHANNELS[interval]
  if (exchange === 'OKX' && !channel) {
    status(onStatus, 'disconnected', `OKX does not stream the ${interval} interval`)
    return noSubscription()
  }

  let stopped = false
  let socket: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  let lastMessageAt = 0
  let lastPingAt = 0
  let retryCount = 0

  const connect = (): void => {
    if (stopped) return
    status(onStatus, retryCount === 0 ? 'connecting' : 'reconnecting')
    const url = exchange === 'BINANCE'
      ? `wss://data-stream.binance.vision/ws/btcusdt@kline_${interval}`
      // OKX retired public port 8443 in October 2026; use default TLS port 443.
      : 'wss://ws.okx.com/ws/v5/business'

    try {
      socket = new WebSocket(url)
    } catch (error) {
      scheduleReconnect(error instanceof Error ? error.message : 'WebSocket could not start')
      return
    }

    socket.onopen = () => {
      if (stableTimer !== undefined) clearTimeout(stableTimer)
      stableTimer = setTimeout(() => {
        retryCount = 0
        stableTimer = undefined
      }, 30_000)
      if (exchange === 'OKX') {
        lastMessageAt = Date.now()
        lastPingAt = 0
        socket?.send(JSON.stringify({
          op: 'subscribe',
          args: [{ channel, instId: 'BTC-USDT' }],
        }))
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
        heartbeatTimer = setInterval(() => {
          if (stopped || !socket || socket.readyState !== WebSocket.OPEN) return
          const now = Date.now()
          if (lastPingAt && now - lastPingAt >= 10_000) {
            socket.close()
            return
          }
          if (!lastPingAt && now - lastMessageAt >= 20_000) {
            lastPingAt = now
            socket.send('ping')
          }
        }, 5_000)
      }
    }

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      if (exchange === 'OKX') {
        lastMessageAt = Date.now()
        if (event.data === 'ping') {
          socket?.send('pong')
          return
        }
        if (event.data === 'pong') {
          lastPingAt = 0
          return
        }
        // Any exchange response proves the connection is alive.
        lastPingAt = 0
      }
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>
        if (exchange === 'BINANCE') {
          const kline = payload.k as Record<string, unknown> | undefined
          if (!kline) return
          const bar: Bar = {
            time: Math.floor(Number(kline.t) / 1000),
            open: Number(kline.o),
            high: Number(kline.h),
            low: Number(kline.l),
            close: Number(kline.c),
            volume: Number(kline.v),
          }
          if ([bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) {
            status(onStatus, 'live')
            onBar(bar)
          }
          return
        }

        const rows = payload.data as unknown[] | undefined
        if (!Array.isArray(rows)) return
        for (const item of rows) {
          if (!Array.isArray(item) || item.length < 6) continue
          const bar: Bar = {
            time: Math.floor(Number(item[0]) / 1000),
            open: Number(item[1]),
            high: Number(item[2]),
            low: Number(item[3]),
            close: Number(item[4]),
            volume: Number(item[5]),
          }
          if ([bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) {
            status(onStatus, 'live')
            onBar(bar)
          }
        }
      } catch {
        // Subscription acknowledgements, heartbeat frames and other metadata
        // are not candle updates.
      }
    }

    socket.onerror = () => {
      status(onStatus, 'reconnecting', 'Exchange WebSocket connection error')
    }
    socket.onclose = () => {
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
      if (stableTimer !== undefined) clearTimeout(stableTimer)
      stableTimer = undefined
      if (!stopped) scheduleReconnect('Exchange WebSocket disconnected')
    }
  }

  const scheduleReconnect = (message: string): void => {
    if (stopped || retryTimer !== undefined) return
    status(onStatus, retryCount === 0 ? 'connecting' : 'reconnecting', message)
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
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    if (stableTimer !== undefined) clearTimeout(stableTimer)
    retryTimer = undefined
    heartbeatTimer = undefined
    stableTimer = undefined
    const current = socket
    socket = null
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
