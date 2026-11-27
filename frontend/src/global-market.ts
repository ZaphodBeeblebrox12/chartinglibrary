import type { Bar, BarsRequest, LiveBarMeta, UnsubscribeFn } from 'openalgo-charts'
import type { GlobalMarketInstrument } from './api'
import type { RealtimeStatus } from './realtime'

const API = 'https://biquote.io'
const HUB = 'https://biquote.io/hubs/tick'
const RS = String.fromCharCode(0x1e)

export interface BiquoteCandle {
  openTime: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
  tickVolume?: number
  isOpen?: boolean
}

export function toBiquoteBar(candle: BiquoteCandle): Bar | undefined {
  const time = Date.parse(candle.openTime)
  const values = [candle.open, candle.high, candle.low, candle.close]
  if (!Number.isFinite(time) || !values.every(value => Number.isFinite(Number(value)))) return undefined
  const tickVolume = Number(candle.tickVolume ?? candle.volume)
  return {
    time: Math.floor(time / 1000),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    ...(Number.isFinite(tickVolume) && tickVolume > 0 ? { volume: tickVolume } : {}),
  }
}

export function parseSignalRFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(RS)
  return { frames: parts.slice(0, -1).filter(Boolean), rest: parts.at(-1) ?? '' }
}

function notifyStatus(
  callback: (status: RealtimeStatus) => void,
  state: RealtimeStatus['state'],
  message?: string,
) {
  callback({ state, ...(message ? { message } : {}), updatedAt: Date.now() })
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

async function negotiateSignalR(signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${HUB}/negotiate?negotiateVersion=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: '',
    signal,
  })
  if (!response.ok) throw new Error(`Biquote SignalR negotiation returned HTTP ${response.status}`)
  const payload = await response.json() as {
    connectionToken?: string
    connectionId?: string
    error?: string
    url?: string
    accessToken?: string
  }
  if (payload.error) throw new Error(payload.error)
  if (payload.url) throw new Error('Biquote redirected its SignalR hub; this endpoint is not supported by the direct client')
  const token = payload.connectionToken ?? payload.connectionId
  if (!token) throw new Error('Biquote SignalR negotiation did not return a connection token')
  return token
}

/**
 * Public Biquote OHLC history. The provider returns a rolling history window,
 * not an unlimited archive. FX/CFD volume is tick volume, not exchange-traded
 * volume; the UI must preserve this provenance.
 */
export async function fetchBiquoteCandles(
  symbol: string,
  interval: string,
  date: string,
  signal?: AbortSignal,
): Promise<Bar[]> {
  const from = `${date}T00:00:00.000Z`
  const to = `${date}T23:59:59.999Z`
  const params = new URLSearchParams({ interval, limit: '1000', from, to })
  const response = await fetch(
    `${API}/api/${encodeURIComponent(symbol)}/ohlc?${params.toString()}`,
    { headers: { Accept: 'application/json' }, signal },
  )
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `Biquote history returned HTTP ${response.status}`)
  }
  const payload = await response.json() as { symbol?: string; interval?: string; bars?: BiquoteCandle[] }
  if (!Array.isArray(payload.bars)) return []
  return payload.bars
    .filter(candle => {
      const time = Date.parse(candle.openTime)
      return Number.isFinite(time) && time >= Date.parse(from) && time < Date.parse(to)
    })
    .map(toBiquoteBar)
    .filter((bar): bar is Bar => bar !== undefined)
    .sort((a, b) => a.time - b.time)
}

/**
 * Minimal SignalR JSON-protocol client for Biquote's documented public Hub.
 * It performs the standard HTTP negotiate + JSON handshake, subscribes to the
 * provider's closed-candle channel, and reconnects/resubscribes after drops.
 * No SDK dependency, credentials, order APIs or demo trading are involved.
 */
export function subscribeBiquoteBars(
  instrument: GlobalMarketInstrument,
  request: BarsRequest,
  selectedDate: string,
  onBar: (bar: Bar, meta?: LiveBarMeta) => void,
  onStatus: (status: RealtimeStatus) => void,
  onPrice?: (price: number, timestamp: string) => void,
): UnsubscribeFn {
  if (request.signal?.aborted) return () => undefined
  if (selectedDate !== todayUTC()) {
    notifyStatus(onStatus, 'disconnected', 'Historical UTC date selected; live stream paused')
    return () => undefined
  }
  if (typeof WebSocket === 'undefined') {
    notifyStatus(onStatus, 'disconnected', 'WebSocket is unavailable in this browser')
    return () => undefined
  }

  let stopped = false
  let socket: WebSocket | undefined
  let buffer = ''
  let handshakeComplete = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  let retryCount = 0
  let reconnectController: AbortController | undefined

  const sendHub = (message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message) + RS)
  }

  const subscribe = () => {
    sendHub({ type: 1, target: 'SubscribeCandles', arguments: [[instrument.name], request.interval] })
    // The candle endpoint and ReceiveCandle event are mid-price based. Tick
    // events are not used to fabricate tradable volume or intra-bar extremes.
  }

  const handleFrame = (frame: string) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(frame) as Record<string, unknown>
    } catch {
      return
    }
    if (!handshakeComplete) {
      if (message.error) {
        socket?.close()
        notifyStatus(onStatus, 'reconnecting', String(message.error))
        return
      }
      handshakeComplete = true
      subscribe()
      return
    }
    if (message.type === 6) return // SignalR keepalive ping
    if (message.type === 7) {
      socket?.close()
      return
    }
    if (message.type !== 1 || message.target !== 'ReceiveCandle') return
    const args = message.arguments as BiquoteCandle[] | undefined
    const candle = args?.[0]
    if (!candle || typeof candle.openTime !== 'string' || !candle.openTime.startsWith(selectedDate)) return
    const bar = toBiquoteBar(candle)
    if (!bar) return
    onBar(bar)
    onPrice?.(bar.close, candle.openTime)
    notifyStatus(onStatus, 'live')
  }

  const scheduleReconnect = (reason: string) => {
    if (stopped || retryTimer !== undefined) return
    notifyStatus(onStatus, 'reconnecting', reason)
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(retryCount, 5)))
    retryCount += 1
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void connect()
    }, delay)
  }

  const connect = async () => {
    if (stopped) return
    notifyStatus(onStatus, retryCount === 0 ? 'connecting' : 'reconnecting')
    reconnectController?.abort()
    reconnectController = new AbortController()
    try {
      const token = await negotiateSignalR(reconnectController.signal)
      if (stopped) return
      const url = new URL(HUB)
      url.protocol = 'wss:'
      url.searchParams.set('id', token)
      buffer = ''
      handshakeComplete = false
      socket = new WebSocket(url.toString())
      socket.onopen = () => {
        if (stableTimer !== undefined) clearTimeout(stableTimer)
        stableTimer = setTimeout(() => {
          retryCount = 0
          stableTimer = undefined
        }, 30_000)
        sendHub({ protocol: 'json', version: 1 })
        if (pingTimer !== undefined) clearInterval(pingTimer)
        pingTimer = setInterval(() => {
          sendHub({ type: 6 })
        }, 15_000)
      }
      socket.onmessage = event => {
        if (typeof event.data !== 'string') return
        buffer += event.data
        const parsed = parseSignalRFrames(buffer)
        buffer = parsed.rest
        parsed.frames.forEach(handleFrame)
      }
      socket.onerror = () => notifyStatus(onStatus, 'reconnecting', 'Biquote SignalR WebSocket error')
      socket.onclose = () => {
        if (pingTimer !== undefined) clearInterval(pingTimer)
        pingTimer = undefined
        if (stableTimer !== undefined) clearTimeout(stableTimer)
        stableTimer = undefined
        if (!stopped) scheduleReconnect('Biquote market-data stream disconnected')
      }
    } catch (error) {
      if (stopped || reconnectController.signal.aborted) return
      scheduleReconnect(error instanceof Error ? error.message : 'Biquote connection failed')
    }
  }

  void connect()
  return () => {
    stopped = true
    reconnectController?.abort()
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    if (pingTimer !== undefined) clearInterval(pingTimer)
    if (stableTimer !== undefined) clearTimeout(stableTimer)
    const current = socket
    socket = undefined
    if (current) {
      current.onopen = null
      current.onmessage = null
      current.onerror = null
      current.onclose = null
      current.close()
    }
    notifyStatus(onStatus, 'disconnected')
  }
}
