import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BarsRequest } from 'openalgo-charts'
import { fetchBiquoteCandles, parseSignalRFrames, subscribeBiquoteBars, toBiquoteBar } from './global-market'
import type { GlobalMarketInstrument } from './api'

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
  message(data: string) { this.onmessage?.({ data } as MessageEvent) }
}

const instrument: GlobalMarketInstrument = {
  name: 'EURUSD', description: 'Euro vs US Dollar',
  type: 'Forex', exchange: 'Forex', source: 'MT5',
}
const request = {
  symbol: 'EURUSD', exchange: 'BIQUOTE', interval: '5m',
} as BarsRequest

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeWebSocket.instances = []
})

describe('Biquote candle adapter', () => {
  it('maps UTC candle open-time and tick volume', () => {
    expect(toBiquoteBar({
      openTime: '2026-11-27T10:15:00Z',
      open: 1.15, high: 1.16, low: 1.14, close: 1.155,
      volume: 0, tickVolume: 124, isOpen: true,
    })).toEqual({
      time: Date.parse('2026-11-27T10:15:00Z') / 1000,
      open: 1.15, high: 1.16, low: 1.14, close: 1.155, volume: 124,
    })
  })

  it('ignores malformed or unparseable OHLC values', () => {
    expect(toBiquoteBar({
      openTime: 'not-a-date', open: 1, high: 1, low: 1, close: 1,
    })).toBeUndefined()
  })

  it('splits SignalR record-separated frames and preserves incomplete remainder', () => {
    expect(parseSignalRFrames('{"type":6}\u001e{"type":1}')).toEqual({
      frames: ['{"type":6}'],
      rest: '{"type":1}',
    })
  })

  it('loads only the requested UTC date and filters provider open-time', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: 'EURUSD',
        interval: '5m',
        bars: [
          { openTime: '2026-11-27T10:00:00Z', open: 1, high: 2, low: 1, close: 2, tickVolume: 50 },
          { openTime: '2026-11-26T23:55:00Z', open: 1, high: 2, low: 1, close: 2, tickVolume: 40 },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const bars = await fetchBiquoteCandles('EURUSD', '5m', '2026-11-27')

    expect(bars).toHaveLength(1)
    expect(bars[0].close).toBe(2)
    expect(bars[0].volume).toBe(50)
    expect(String(fetchMock.mock.calls[0][0])).toContain('from=2026-11-27T00%3A00%3A00.000Z')
  })

  it('negotiates the SignalR hub, subscribes to candles, and maps ReceiveCandle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connectionId: 'test-token', connectionToken: 'test-secret' }),
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onBar = vi.fn()
    const onStatus = vi.fn()
    const today = new Date().toISOString().slice(0, 10)

    const unsubscribe = subscribeBiquoteBars(
      instrument, request, today, onBar, onStatus,
    )
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toContain('wss://biquote.io/hubs/tick?id=test-secret')

    socket.open()
    expect(socket.sent[0]).toBe('{"protocol":"json","version":1}\u001e')
    socket.message('{}\u001e')
    expect(socket.sent[1]).toBe(JSON.stringify({
      type: 1, target: 'SubscribeCandles', arguments: [['EURUSD'], '5m'],
    }) + '\u001e')

    socket.message(JSON.stringify({
      type: 1,
      target: 'ReceiveCandle',
      arguments: [{
        symbol: 'EURUSD', interval: '5m',
        openTime: `${today}T10:00:00Z`,
        open: 1.15, high: 1.16, low: 1.14, close: 1.155,
        volume: 0, tickVolume: 88,
      }],
    }) + '\u001e')
    expect(onBar).toHaveBeenCalledWith(expect.objectContaining({
      open: 1.15, high: 1.16, low: 1.14, close: 1.155, volume: 88,
    }))
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'live' }))
    unsubscribe()
    expect(socket.closeCalls).toBe(1)
  })
})
