import type { BarsRequest, DataFeed, SymbolMatch, SymbolSearchRequest } from 'openalgo-charts'
import {
  fetchOptionHistory,
  fetchUnderlyingCandles,
  type IndexName,
} from './api'
import {
  createFixtureBars,
  mapOptionSnapshots,
  mapUnderlyingCandles,
  optionSymbol,
  parseOptionSymbol,
  type OptionMetrics,
} from './data'

export type FeedSource = 'database-underlying' | 'database-options' | 'demo' | 'empty' | 'unsupported'

export interface FeedResult {
  source: FeedSource
  connection: 'connected' | 'offline' | 'unknown'
  label: string
  detail: string
  barCount: number
  latest?: OptionMetrics
}

export interface FeedContext {
  index: IndexName
  strike: number
  side: 'CE' | 'PE'
  date: string
  onResult: (result: FeedResult) => void
}

type Interval = '5m' | '15m' | '30m' | '1h'

const UNDERLYING_INTERVALS: ReadonlySet<string> = new Set(['5m', '15m', '30m', '1h'])

function exchangeForIndex(index: IndexName, option: boolean): string {
  if (option) return index === 'NIFTY' ? 'NFO' : 'BFO'
  return index === 'NIFTY' ? 'NSE' : 'BSE'
}

export class TradeThesisDataFeed implements DataFeed {
  constructor(private readonly getContext: () => FeedContext) {}

  async getBars(request: BarsRequest) {
    const context = this.getContext()
    const option = parseOptionSymbol(request.symbol)
    const index = option?.index ?? (request.symbol.toUpperCase() === 'SENSEX' ? 'SENSEX' : context.index)
    const strike = option?.strike ?? context.strike
    const side = option?.side ?? context.side
    const isOption = option !== undefined || request.exchange === 'NFO' || request.exchange === 'BFO'

    if (!isOption && !UNDERLYING_INTERVALS.has(request.interval)) {
      context.onResult({
        source: 'unsupported',
        connection: 'unknown',
        label: 'Timeframe not available',
        detail: 'The existing dashboard stores underlying candles at 5m, 15m, 30m and 1h for this chart API.',
        barCount: 0,
      })
      return []
    }

    try {
      if (isOption) {
        const points = await fetchOptionHistory(index, strike, context.date, request.signal)
        const mapped = mapOptionSnapshots(points, side)
        const bars = mapped.bars.filter((bar) =>
          (request.from === undefined || bar.time >= request.from) &&
          (request.to === undefined || bar.time <= request.to),
        )
        context.onResult({
          source: bars.length ? 'database-options' : 'empty',
          connection: 'connected',
          label: bars.length ? 'Saved option snapshots' : 'No saved option observations',
          detail: bars.length
            ? 'Sampled LTP observations · approximately 30-second capture cadence · legacy expiry identity unknown'
            : `No ${index} ${strike} ${side} observations were found for ${context.date}.`,
          barCount: bars.length,
          latest: mapped.latest,
        })
        return bars
      }

      const rows = await fetchUnderlyingCandles(
        index,
        request.interval as Interval,
        context.date,
        request.signal,
      )
      const bars = mapUnderlyingCandles(rows).filter((bar) =>
        (request.from === undefined || bar.time >= request.from) &&
        (request.to === undefined || bar.time <= request.to),
      )
      context.onResult({
        source: bars.length ? 'database-underlying' : 'empty',
        connection: 'connected',
        label: bars.length ? 'Saved underlying candles' : 'No saved candles',
        detail: bars.length
          ? 'Tick-built underlying OHLC · volume is not supplied for the index cash feed'
          : `No ${index} candles were found for ${context.date} at ${request.interval}.`,
        barCount: bars.length,
      })
      return bars
    } catch (error) {
      if (request.signal?.aborted) throw error
      const message = error instanceof Error ? error.message : 'Unable to reach the local Options Dashboard API'
      const bars = createFixtureBars(
        isOption ? optionSymbol(index, strike, side) : index,
        request.interval,
        context.date,
        isOption,
      ).filter((bar) =>
        (request.from === undefined || bar.time >= request.from) &&
        (request.to === undefined || bar.time <= request.to),
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
    ]
    const optionChoices: SymbolMatch[] = [
      {
        symbol: optionSymbol(context.index, context.strike, 'CE'),
        exchange: exchangeForIndex(context.index, true),
        name: `${context.index} ${context.strike} Call · expiry unknown in legacy history`,
        assetClass: 'Option',
      },
      {
        symbol: optionSymbol(context.index, context.strike, 'PE'),
        exchange: exchangeForIndex(context.index, true),
        name: `${context.index} ${context.strike} Put · expiry unknown in legacy history`,
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
