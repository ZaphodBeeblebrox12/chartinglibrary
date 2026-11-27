import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BarsRequest } from 'openalgo-charts'
import { OptionsDashboardRealtimeProvider } from './options-realtime'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  sent: string[] = []
  closeCalls = 0

  constructor(public url: string) { FakeWebSocket.instances.push(this) }
  send(value: string) { this.sent.push(value) }
  close() { this.closeCalls += 1; this.readyState = 3 }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.({} as Event) }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent) }
}

const todayIST = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeWebSocket.instances = []
})

describe('Options Dashboard live chart bridge', () => {
  it('subscribes to the shared backend websocket and maps a selected option expiry, LTP and Greeks', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'http:', host: '127.0.0.1:5173' } })
    const today = todayIST()
    const onBar = vi.fn()
    const onStatus = vi.fn()
    const onMetrics = vi.fn()
    const provider = new OptionsDashboardRealtimeProvider(() => today, onMetrics)
    const request = {
      symbol: 'NIFTY-25000-CE-26NOV2026',
      exchange: 'NFO',
      interval: '1m',
      variant: { unit: `${today}|OPTION-26NOV2026` },
    } as BarsRequest

    const unsubscribe = provider.subscribeBars(request, onBar, onStatus)
    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toBe('ws://127.0.0.1:5173/ws')
    socket.open()
    socket.message({
      type: 'tick',
      data: {
        index_name: 'NIFTY',
        expiry: '26NOV2026',
        timestamp: `${today}T09:15:30+05:30`,
        option_age_sec: 1.2,
        options: [{
          strike: 25000,
          option_type: 'CE',
          ltp: 101.5,
          oi: 120000,
          oi_change: 5000,
          volume: 20000,
          iv: 14.5,
          delta: 0.52,
          gamma: 0.0005,
          theta: -3.1,
          vega: 5.7,
          gex: 120000,
          source_updated_at: `${today}T09:15:30+05:30`,
          source_age_sec: 1.2,
        }],
      },
    })

    expect(onBar).toHaveBeenCalledWith(expect.objectContaining({
      open: 101.5, high: 101.5, low: 101.5, close: 101.5,
    }))
    expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({
      ltp: 101.5, oi: 120000, oiChange: 5000, iv: 14.5,
      delta: 0.52, gamma: 0.0005, theta: -3.1, vega: 5.7, gex: 120000,
      sourceAgeSec: 1.2,
    }))
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'live' }))
    unsubscribe()
    expect(socket.closeCalls).toBe(1)
  })

  it('does not mix a different expiry or a stale option quote into the selected contract', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } })
    const today = todayIST()
    const onBar = vi.fn()
    const onMetrics = vi.fn()
    const provider = new OptionsDashboardRealtimeProvider(() => today, onMetrics)
    const request = {
      symbol: 'SENSEX-85000-PE-03DEC2026',
      exchange: 'BFO',
      interval: '1m',
      variant: { unit: `${today}|OPTION-03DEC2026` },
    } as BarsRequest
    const unsubscribe = provider.subscribeBars(request, onBar, vi.fn())
    const socket = FakeWebSocket.instances[0]
    socket.open()

    socket.message({ type: 'tick', data: {
      index_name: 'SENSEX', expiry: '26NOV2026', option_age_sec: 1,
      timestamp: `${today}T09:15:30+05:30`,
      options: [{ strike: 85000, option_type: 'PE', ltp: 120, source_age_sec: 1 }],
    } })
    socket.message({ type: 'tick', data: {
      index_name: 'SENSEX', expiry: '03DEC2026', option_age_sec: 1,
      timestamp: `${today}T09:15:30+05:30`,
      options: [{ strike: 85000, option_type: 'PE', ltp: 120, source_age_sec: 120 }],
    } })

    expect(onBar).not.toHaveBeenCalled()
    expect(onMetrics).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('aggregates persisted NSE cash candles into the selected intraday timeframe', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } })
    const today = todayIST()
    const onBar = vi.fn()
    const provider = new OptionsDashboardRealtimeProvider(() => today)
    const request = {
      symbol: 'NIFTY',
      exchange: 'NSE',
      interval: '5m',
      variant: { unit: `${today}|INDEX` },
    } as BarsRequest
    const unsubscribe = provider.subscribeBars(request, onBar, vi.fn())
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.message({ type: 'chart_candle', data: {
      symbol: 'NIFTY', ts_minute: `${today} 09:15:00`,
      open: 26000, high: 26010, low: 25995, close: 26005, volume: null,
    } })
    socket.message({ type: 'chart_candle', data: {
      symbol: 'NIFTY', ts_minute: `${today} 09:16:00`,
      open: 26005, high: 26020, low: 26000, close: 26015, volume: null,
    } })

    expect(onBar).toHaveBeenCalledTimes(2)
    expect(onBar.mock.calls[1][0]).toEqual(expect.objectContaining({
      open: 26000, high: 26020, low: 25995, close: 26015,
    }))
    unsubscribe()
  })

  it('uses the MCX 09:00 session open for front-month commodity bars', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } })
    const today = todayIST()
    const onBar = vi.fn()
    const provider = new OptionsDashboardRealtimeProvider(() => today)
    const request = {
      symbol: 'GOLD',
      exchange: 'MCX',
      interval: '1h',
      variant: { unit: `${today}|CASH-COMMODITY-MCX-GOLD` },
    } as BarsRequest
    const unsubscribe = provider.subscribeBars(request, onBar, vi.fn())
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.message({ type: 'chart_candle', data: {
      symbol: 'GOLD', ts_minute: `${today} 09:00:00`,
      open: 70000, high: 70010, low: 69990, close: 70005,
    } })
    expect(onBar).toHaveBeenCalledWith(expect.objectContaining({
      open: 70000, high: 70010, low: 69990, close: 70005,
    }))
    unsubscribe()
  })
})
