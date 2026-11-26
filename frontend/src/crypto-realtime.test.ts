import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BarsRequest } from 'openalgo-charts'
import { subscribeCryptoBars } from './crypto-realtime'

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

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.closeCalls += 1
    this.readyState = 3
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({} as Event)
  }

  message(data: string) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

const request = {
  symbol: 'BTC-USDT',
  exchange: 'OKX',
  interval: '1m',
} as BarsRequest

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeWebSocket.instances = []
})

describe('OKX public realtime candles', () => {
  it('uses port 443, subscribes to the candle channel and maps spot updates', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onBar = vi.fn()
    const onStatus = vi.fn()
    const unsubscribe = subscribeCryptoBars(
      'OKX',
      request,
      new Date().toISOString().slice(0, 10),
      onBar,
      onStatus,
    )
    const socket = FakeWebSocket.instances[0]

    expect(socket.url).toBe('wss://ws.okx.com/ws/v5/business')
    socket.open()
    expect(JSON.parse(socket.sent[0])).toEqual({
      op: 'subscribe',
      args: [{ channel: 'candle1m', instId: 'BTC-USDT' }],
    })

    socket.message(JSON.stringify({
      arg: { channel: 'candle1m', instId: 'BTC-USDT' },
      data: [['1795651200000', '90000', '91000', '89500', '90500', '12.5', '1125000', '1125000', '0']],
    }))
    expect(onBar).toHaveBeenCalledWith({
      time: 1795651200,
      open: 90000,
      high: 91000,
      low: 89500,
      close: 90500,
      volume: 12.5,
    })
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'live' }))
    unsubscribe()
    expect(socket.closeCalls).toBe(1)
  })

  it('sends the OKX heartbeat ping and reconnect-closes when pong is missing', () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const unsubscribe = subscribeCryptoBars(
      'OKX',
      request,
      new Date().toISOString().slice(0, 10),
      vi.fn(),
      vi.fn(),
    )
    const socket = FakeWebSocket.instances[0]
    socket.open()

    vi.advanceTimersByTime(25_000)
    expect(socket.sent).toContain('ping')
    vi.advanceTimersByTime(10_000)
    expect(socket.closeCalls).toBe(1)

    unsubscribe()
  })
})
