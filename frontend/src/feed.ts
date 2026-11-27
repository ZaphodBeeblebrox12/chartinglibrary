import type { Bar, BarSubscriptionOptions, BarsRequest, DataFeed, LiveBarMeta, SymbolMatch, SymbolSearchRequest, UnsubscribeFn } from 'openalgo-charts'
import type { RealtimeProvider, RealtimeStatus } from './realtime'
import {
  fetchCryptoCandles,
  fetchOptionHistory,
  fetchUnderlyingCandles,
  type CryptoExchange,
  type IndexName,
} from './api'
import {
  createFixtureBars,
  mapCryptoCandles,
  mapOptionSnapshots,
  mapUnderlyingCandles,
  optionSymbol,
  parseOptionSymbol,
  type OptionMetrics,
} from './data'
import { subscribeCryptoBars } from './crypto-realtime'

export type FeedSource = 'database-underlying' | 'database-options' | 'exchange-crypto' | 'demo' | 'empty' | 'unsupported'

export interface FeedResult {
  source: FeedSource
  connection: 'connected' | 'offline' | 'unknown'
  label: string
  detail: string
  barCount: number
  latest?: OptionMetrics
}

export interface FeedContext {
  market: 'INDEX' | 'BTC'
  mode: 'underlying' | 'option'
  cryptoExchange: CryptoExchange
  index: IndexName
  strike: number
  side: 'CE' | 'PE'
  date: string
  expiry: string
  interval: string
  theme: 'light' | 'dark'
  onResult: (result: FeedResult) => void
  onLiveStatus?: (status: RealtimeStatus) => void
  onLiveMetrics?: (metrics: OptionMetrics) => void
}

export function feedScopeKey(context: FeedContext): string {
  const instrumentScope = context.market === 'BTC'
    ? `BTC-${context.cryptoExchange}`
    : context.mode === 'option'
      ? `OPTION-${context.expiry}`
      : 'INDEX'
  return `${context.date}|${instrumentScope}`
}

function dateFromScope(value: string | undefined, fallback: string): string {
  const candidate = value?.split('|', 1)[0]
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : fallback
}

const UNDERLYING_INTERVALS: ReadonlySet<string> = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d'])
const CRYPTO_INTERVALS: ReadonlySet<string> = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'])

function exchangeForIndex(index: IndexName, option: boolean): string {
  if (option) return index === 'NIFTY' ? 'NFO' : 'BFO'
  return index === 'NIFTY' ? 'NSE' : 'BSE'
}

export class TradeThesisDataFeed implements DataFeed {
  public subscribeBars?: (
    request: BarsRequest,
    onBar: (bar: Bar, meta?: LiveBarMeta) => void,
    opts?: BarSubscriptionOptions,
  ) => UnsubscribeFn

  public dataVariants() {
    // 'unit' is an opaque provider series key. It scopes this feed's history
    // to a selected day and contract; it is not a physical measurement unit.
    return { units: [feedScopeKey(this.getContext())] }
  }

  constructor(
    private readonly getContext: () => FeedContext,
    realtimeProvider?: RealtimeProvider,
  ) {
    this.subscribeBars = (request, onBar, opts) => {
      const context = this.getContext()
      const exchange = request.exchange.toUpperCase()
      if (exchange === 'BINANCE' || exchange === 'OKX') {
        const selectedDate = dateFromScope(request.variant?.unit, context.date)
        return subscribeCryptoBars(
          exchange,
          request,
          selectedDate,
          onBar,
          (status) => context.onLiveStatus?.(status),
        )
      }
      if (realtimeProvider) {
        return realtimeProvider.subscribeBars(
          request,
          onBar,
          (status) => this.getContext().onLiveStatus?.(status),
          opts,
        )
      }
      return () => undefined
    }
  }

  async getBars(request: BarsRequest) {
    const context = this.getContext()
    const selectedDate = dateFromScope(request.variant?.unit, context.date)
    const option = parseOptionSymbol(request.symbol)
    const index = option?.index ?? (request.symbol.toUpperCase() === 'SENSEX' ? 'SENSEX' : context.index)
    const strike = option?.strike ?? context.strike
    const side = option?.side ?? context.side
    const exchange = request.exchange.toUpperCase()
    const isCrypto = exchange === 'BINANCE' || exchange === 'OKX'
    const isOption = option !== undefined || exchange === 'NFO' || exchange === 'BFO'
    const selectedExpiry = option?.expiry ?? context.expiry

    if (isCrypto && !CRYPTO_INTERVALS.has(request.interval)) {
      context.onResult({
        source: 'unsupported',
        connection: 'unknown',
        label: 'Crypto timeframe not available',
        detail: `The ${exchange} BTC/USDT spot adapter supports 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h and 1d.`,
        barCount: 0,
      })
      return []
    }

    if (!isCrypto && !isOption && !UNDERLYING_INTERVALS.has(request.interval)) {
      context.onResult({
        source: 'unsupported',
        connection: 'unknown',
        label: 'Timeframe not available',
        detail: 'The Options Dashboard candle store supports 1m, 5m, 15m, 30m, 1h, 4h and 1d.',
        barCount: 0,
      })
      return []
    }

    try {
      if (isCrypto) {
        const rows = await fetchCryptoCandles(exchange, request.interval, selectedDate, request.signal)
        const bars = mapCryptoCandles(rows)
        context.onResult({
          source: bars.length ? 'exchange-crypto' : 'empty',
          connection: 'connected',
          label: bars.length ? `${exchange} SPOT · BTC/USDT` : `No BTC/USDT candles on ${selectedDate} UTC`,
          detail: bars.length
            ? `Public ${exchange} spot OHLCV · UTC timestamps · ${bars.length} candles`
            : `No ${exchange} BTC/USDT observations were returned for ${selectedDate} UTC.`,
          barCount: bars.length,
        })
        return bars
      }

      if (isOption) {
        const history = await fetchOptionHistory(index, strike, side, selectedExpiry, selectedDate, request.signal)
        const mapped = mapOptionSnapshots(history.points, side)
        // The backend endpoint is date-scoped. Return the full selected
        // session so older saved dates are not hidden by the widget's
        // default lookback window anchored to today's clock.
        const bars = mapped.bars
        context.onResult({
          source: bars.length ? 'database-options' : 'empty',
          connection: 'connected',
          label: bars.length ? 'Saved option snapshots' : 'No saved option observations',
          detail: bars.length
            ? [
                '1m bars from ~30-second LTP samples · OHLC reflects observed samples only',
                selectedExpiry === 'UNKNOWN' ? 'legacy expiry unknown' : 'expiry ' + selectedExpiry,
                mapped.latest?.sourceAgeSec === undefined ? '' : `capture source age ${mapped.latest.sourceAgeSec.toFixed(1)}s`,
                history.quality?.gaps_detected ? 'capture gaps over 90s detected' : '',
                history.quality?.missing_expiry_rows ? `${history.quality.missing_expiry_rows} legacy snapshots have unknown expiry` : '',
              ].filter(Boolean).join(' · ')
            : `No ${index} ${strike} ${side} observations were found for ${selectedDate}.`,
          barCount: bars.length,
          latest: mapped.latest,
        })
        return bars
      }

      const rows = await fetchUnderlyingCandles(
        index,
        request.interval,
        selectedDate,
        request.signal,
      )
      // The local endpoint returns one complete session. Do not compare
      // the selected historical date against a "now"-based chart lookback.
      const bars = mapUnderlyingCandles(rows)
      context.onResult({
        source: bars.length ? 'database-underlying' : 'empty',
        connection: 'connected',
        label: bars.length ? 'Saved underlying candles' : 'No saved candles',
        detail: bars.length
          ? 'Tick-built underlying OHLC · volume is not supplied for the index cash feed'
          : `No ${index} candles were found for ${selectedDate} at ${request.interval}.`,
        barCount: bars.length,
      })
      return bars
    } catch (error) {
      if (request.signal?.aborted) throw error
      const message = error instanceof Error ? error.message : 'Unable to reach the market-data service'
      if (isCrypto) {
        context.onResult({
          source: 'empty',
          connection: 'offline',
          label: `${exchange} DATA UNAVAILABLE`,
          detail: `${message}. No synthetic BTC prices are substituted.`,
          barCount: 0,
        })
        return []
      }
      const bars = createFixtureBars(
        isOption ? optionSymbol(index, strike, side) : index,
        request.interval,
        selectedDate,
        isOption,
      )
      context.onResult({
        source: 'demo',
        connection: 'offline',
        label: 'DEMO DATA · backend unavailable',
        detail: `${message}. These deterministic sample values are not market data.`,
        barCount: bars.length,
      })
      return bars
    }
  }

  async searchSymbols(request: SymbolSearchRequest): Promise<SymbolMatch[]> {
    if (request.signal?.aborted) return []
    const context = this.getContext()
    const query = request.query.trim().toUpperCase()
    const indexChoices: SymbolMatch[] = [
      { symbol: 'NIFTY', exchange: 'NSE', name: 'NIFTY 50', assetClass: 'Index' },
      { symbol: 'SENSEX', exchange: 'BSE', name: 'BSE SENSEX', assetClass: 'Index' },
      { symbol: 'BTCUSDT', exchange: 'BINANCE', name: 'BTC/USDT · Binance Spot', assetClass: 'Crypto' },
      { symbol: 'BTC-USDT', exchange: 'OKX', name: 'BTC/USDT · OKX Spot', assetClass: 'Crypto' },
    ]
    const optionChoices: SymbolMatch[] = [
      {
        symbol: optionSymbol(context.index, context.strike, 'CE', context.expiry),
        exchange: exchangeForIndex(context.index, true),
        name: `${context.index} ${context.strike} Call · ${context.expiry}`,
        assetClass: 'Option',
      },
      {
        symbol: optionSymbol(context.index, context.strike, 'PE', context.expiry),
        exchange: exchangeForIndex(context.index, true),
        name: `${context.index} ${context.strike} Put · ${context.expiry}`,
        assetClass: 'Option',
      },
    ]
    const choices = [...indexChoices, ...optionChoices]
    if (!query) return choices
    return choices.filter((item) =>
      item.symbol.includes(query) ||
      item.name?.toUpperCase().includes(query),
    )
  }
}
