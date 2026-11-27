import { describe, expect, it } from 'vitest'
import { feedScopeKey, type FeedContext } from './feed'

const base: FeedContext = {
  market: 'INDEX',
  mode: 'underlying',
  cryptoExchange: 'BINANCE',
  selectedCashInstrument: 'RELIANCE',
  selectedCashExchange: 'NSE',
  globalSymbol: 'EURUSD',
  cashInstruments: [
    { name: 'RELIANCE', kind: 'STOCK', tier: 2, exchange: 'NSE' },
    { name: 'GOLD', kind: 'COMMODITY', tier: 2, exchange: 'MCX' },
  ],
  globalInstruments: [{
    name: 'EURUSD', description: 'Euro vs US Dollar',
    type: 'Forex', exchange: 'Forex', source: 'MT5',
  }],
  index: 'NIFTY',
  strike: 25000,
  side: 'CE',
  date: '2026-11-26',
  expiry: '26NOV2026',
  interval: '5m',
  theme: 'light',
  onResult: () => undefined,
}

describe('chart data-series identity', () => {
  it('scopes underlying history to a selected session', () => {
    expect(feedScopeKey(base)).toBe('2026-11-26|INDEX')
    expect(feedScopeKey({ ...base, date: '2026-11-27' })).toBe('2026-11-27|INDEX')
  })

  it('keeps option expiry in the series key', () => {
    expect(feedScopeKey({ ...base, mode: 'option' })).toBe('2026-11-26|OPTION-26NOV2026')
    expect(feedScopeKey({ ...base, mode: 'option', expiry: '03DEC2026' }))
      .toBe('2026-11-26|OPTION-03DEC2026')
  })

  it('isolates cash equities and MCX futures by market type and symbol', () => {
    const stock: FeedContext = { ...base, market: 'STOCK' }
    const commodity: FeedContext = {
      ...base, market: 'COMMODITY', selectedCashInstrument: 'GOLD', selectedCashExchange: 'MCX',
    }
    expect(feedScopeKey(stock)).toBe('2026-11-26|CASH-STOCK-NSE-RELIANCE')
    expect(feedScopeKey(commodity)).toBe('2026-11-26|CASH-COMMODITY-MCX-GOLD')
  })

  it('isolates global provider instruments from exchange-traded crypto', () => {
    const global: FeedContext = { ...base, market: 'GLOBAL', globalSymbol: 'EURUSD' }
    expect(feedScopeKey(global)).toBe('2026-11-26|GLOBAL-EURUSD')
  })

  it('isolates the two crypto exchanges', () => {
    const binance: FeedContext = { ...base, market: 'BTC', cryptoExchange: 'BINANCE' }
    const okx: FeedContext = { ...base, market: 'BTC', cryptoExchange: 'OKX' }
    expect(feedScopeKey(binance)).toBe('2026-11-26|BTC-BINANCE')
    expect(feedScopeKey(okx)).toBe('2026-11-26|BTC-OKX')
  })
})
