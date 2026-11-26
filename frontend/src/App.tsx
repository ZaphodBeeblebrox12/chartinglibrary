import { useEffect, useRef, useState } from 'react'
import { createWidget } from 'openalgo-charts/widget'
import 'openalgo-charts/indicators'
import {
  fetchAvailableDates,
  fetchAvailableExpiries,
  fetchStrikesForDate,
  type CryptoExchange,
  type IndexName,
  type OptionSide,
} from './api'
import { feedScopeKey, TradeThesisDataFeed, type FeedContext, type FeedResult } from './feed'
import { optionSymbol, parseOptionSymbol } from './data'
import type { RealtimeStatus } from './realtime'

type Mode = 'underlying' | 'option'
type Theme = 'light' | 'dark'
type Market = 'INDEX' | 'BTC'

interface SavedContext {
  market?: Market
  mode?: Mode
  index?: IndexName
  strike?: number
  side?: OptionSide
  cryptoExchange?: CryptoExchange
  date?: string
  expiry?: string
  interval?: string
  theme?: Theme
}

const CONTEXT_STORAGE_KEY = 'tradethesis-charts-context-v1'

function readSavedContext(): SavedContext {
  try {
    const raw = window.localStorage.getItem(CONTEXT_STORAGE_KEY)
    return raw ? JSON.parse(raw) as SavedContext : {}
  } catch {
    return {}
  }
}

function todayIST(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return String(values.year) + '-' + String(values.month) + '-' + String(values.day)
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmt(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(value)
}

function fmtInt(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
}

function exchangeFor(index: IndexName, option: boolean): string {
  if (option) return index === 'NIFTY' ? 'NFO' : 'BFO'
  return index === 'NIFTY' ? 'NSE' : 'BSE'
}

function cryptoSymbol(exchange: CryptoExchange): string {
  return exchange === 'BINANCE' ? 'BTCUSDT' : 'BTC-USDT'
}

function dateFromVariant(unit: string | undefined): string | undefined {
  const value = unit?.split('|', 1)[0]
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>
}

export default function App() {
  const savedRef = useRef<SavedContext | null>(null)
  if (savedRef.current === null) savedRef.current = readSavedContext()
  const saved = savedRef.current

  const [market, setMarket] = useState<Market>(saved.market ?? 'INDEX')
  const [mode, setMode] = useState<Mode>(saved.market === 'BTC' ? 'underlying' : (saved.mode ?? 'underlying'))
  const [index, setIndex] = useState<IndexName>(saved.index ?? 'NIFTY')
  const [strike, setStrike] = useState(saved.strike ?? 25000)
  const [side, setSide] = useState<OptionSide>(saved.side ?? 'CE')
  const [cryptoExchange, setCryptoExchange] = useState<CryptoExchange>(saved.cryptoExchange ?? 'BINANCE')
  const [date, setDate] = useState(saved.date ?? (saved.market === 'BTC' ? todayUTC() : todayIST()))
  const [expiry, setExpiry] = useState(saved.expiry ?? 'UNKNOWN')
  const [expiryChoices, setExpiryChoices] = useState<string[]>(['UNKNOWN'])
  const [interval, setInterval] = useState(saved.interval ?? '5m')
  const [theme, setTheme] = useState<Theme>(saved.theme ?? 'light')
  const [widgetReady, setWidgetReady] = useState(false)
  const [apiState, setApiState] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [dates, setDates] = useState<string[]>([])
  const [strikes, setStrikes] = useState<number[]>([])
  const [feed, setFeed] = useState<FeedResult | undefined>()
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>({ state: 'disconnected' })
  const [message, setMessage] = useState('Checking local data service')
  const chartRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<ReturnType<typeof createWidget> | null>(null)

  const onFeedResult = (result: FeedResult) => {
    setFeed(result)
    if (result.connection === 'connected') setApiState('connected')
    if (result.connection === 'offline') setApiState('offline')
  }

  const contextRef = useRef<FeedContext>({
    market,
    mode,
    cryptoExchange,
    index,
    strike,
    side,
    date,
    expiry,
    interval,
    theme,
    onResult: onFeedResult,
    onLiveStatus: setRealtimeStatus,
  })
  contextRef.current = {
    market,
    mode,
    cryptoExchange,
    index,
    strike,
    side,
    date,
    expiry,
    interval,
    theme,
    onResult: onFeedResult,
    onLiveStatus: setRealtimeStatus,
  }

  useEffect(() => {
    if (market === 'BTC') {
      setDates([])
      setApiState('checking')
      setMessage(`Connecting to ${cryptoExchange} public BTC/USDT market data`)
      return
    }

    const controller = new AbortController()
    setApiState('checking')
    fetchAvailableDates(index, controller.signal).then((available) => {
      if (controller.signal.aborted) return
      setDates(available)
      setApiState('connected')
      setMessage('Options Dashboard database connected')
      if (available.length) setDate((current) => available.includes(current) ? current : available[0])
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setApiState('offline')
      setMessage(error instanceof Error ? error.message : 'Local backend unavailable')
      setDates([])
    })
    return () => controller.abort()
  }, [market, index, cryptoExchange])

  useEffect(() => {
    if (market !== 'INDEX' || mode !== 'option') return
    const controller = new AbortController()
    fetchAvailableExpiries(index, date, controller.signal).then((available) => {
      if (controller.signal.aborted) return
      const choices = [
        ...available.expiries,
        ...(available.hasUnknown ? ['UNKNOWN'] : []),
      ]
      const nextChoices = choices.length ? choices : ['UNKNOWN']
      setExpiryChoices(nextChoices)
      setExpiry((current) => nextChoices.includes(current) ? current : nextChoices[0])
    }).catch(() => {
      if (controller.signal.aborted) return
      setExpiryChoices(['UNKNOWN'])
      setExpiry('UNKNOWN')
    })
    return () => controller.abort()
  }, [market, mode, index, date])

  useEffect(() => {
    if (market !== 'INDEX' || mode !== 'option') return
    const controller = new AbortController()
    fetchStrikesForDate(index, date, expiry, controller.signal).then((available) => {
      if (controller.signal.aborted) return
      setStrikes(available)
      if (available.length && !available.includes(strike)) {
        setStrike(available[Math.floor(available.length / 2)])
      }
    }).catch(() => {
      if (!controller.signal.aborted) setStrikes([])
    })
    return () => controller.abort()
  }, [market, mode, index, date, expiry])

  useEffect(() => {
    const container = chartRef.current
    if (!container) return
    const initial = contextRef.current
    const initialSymbol = initial.market === 'BTC'
      ? cryptoSymbol(initial.cryptoExchange)
      : initial.mode === 'option'
        ? optionSymbol(initial.index, initial.strike, initial.side, initial.expiry)
        : initial.index
    const initialExchange = initial.market === 'BTC'
      ? initial.cryptoExchange
      : exchangeFor(initial.index, initial.mode === 'option')

    const widget = createWidget(container, {
      feed: new TradeThesisDataFeed(() => contextRef.current),
      symbol: initialSymbol,
      exchange: initialExchange,
      interval: initial.interval ?? '5m',
      variant: { unit: feedScopeKey(initial) },
      intervals: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'],
      canSelectInterval: (code) => {
        const active = widgetRef.current
        const isOption = parseOptionSymbol(active?.symbol() ?? '') !== undefined
        const exchange = active?.exchange().toUpperCase()
        if (isOption) return code === '1m'
        if (exchange === 'BINANCE' || exchange === 'OKX') {
          return ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].includes(code)
        }
        return ['5m', '15m', '30m', '1h'].includes(code)
      },
      theme: initial.theme ?? 'light',
      chartType: initial.mode === 'option' ? 'line' : 'candlestick',
      rail: true,
      topbar: true,
      fullscreen: true,
      persist: 'tradethesis-charts-v1',
      drawingScope: 'instrument',
      lookbackBars: 1200,
      mobile: 'auto',
    })
    widgetRef.current = widget
    const off = [
      widget.on('symbol', ({ symbol, exchange }) => {
        const contract = parseOptionSymbol(symbol)
        const venue = exchange.toUpperCase()
        if (contract) {
          setMarket('INDEX')
          setMode('option')
          setIndex(contract.index)
          setStrike(contract.strike)
          setSide(contract.side)
          if (contract.expiry) setExpiry(contract.expiry)
        } else if (venue === 'BINANCE' || venue === 'OKX' || symbol === 'BTCUSDT' || symbol === 'BTC-USDT') {
          setMarket('BTC')
          setMode('underlying')
          setCryptoExchange(venue === 'OKX' ? 'OKX' : 'BINANCE')
        } else if (symbol === 'NIFTY' || symbol === 'SENSEX') {
          setMarket('INDEX')
          setMode('underlying')
          setIndex(symbol)
        }
      }),
      widget.on('interval', ({ interval: next }) => setInterval(next)),
      widget.on('theme', ({ theme: next }) => setTheme(next)),
      widget.on('data', ({ bars, error }) => {
        if (error) setMessage(error)
        else if (bars > 0) setMessage('Chart history loaded')
      }),
    ]

    void widget.ready.then(() => {
      if (widget.isDestroyed) return
      setTheme(widget.theme())
      setInterval(widget.interval())
      const contract = parseOptionSymbol(widget.symbol())
      if (contract) {
        setMarket('INDEX')
        setMode('option')
        setIndex(contract.index)
        setStrike(contract.strike)
        setSide(contract.side)
        if (contract.expiry) setExpiry(contract.expiry)
      } else if (widget.exchange().toUpperCase() === 'BINANCE' || widget.exchange().toUpperCase() === 'OKX') {
        setMarket('BTC')
        setMode('underlying')
        setCryptoExchange(widget.exchange().toUpperCase() as CryptoExchange)
      } else if (widget.symbol() === 'NIFTY' || widget.symbol() === 'SENSEX') {
        setMarket('INDEX')
        setMode('underlying')
        setIndex(widget.symbol() as IndexName)
      }
      const restoredDate = dateFromVariant(widget.variant()?.unit)
      if (restoredDate) setDate(restoredDate)
      setWidgetReady(true)
    })

    return () => {
      off.forEach((unsubscribe) => unsubscribe())
      widget.destroy()
      if (widgetRef.current === widget) widgetRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!widgetReady) return
    const widget = widgetRef.current
    if (!widget) return
    void widget.ready.then(() => {
      if (widget.isDestroyed) return
      const symbol = market === 'BTC'
        ? cryptoSymbol(cryptoExchange)
        : mode === 'option'
          ? optionSymbol(index, strike, side, expiry)
          : index
      const exchange = market === 'BTC'
        ? cryptoExchange
        : exchangeFor(index, mode === 'option')
      const symbolChanged = widget.symbol() !== symbol || widget.exchange() !== exchange
      const intervalChanged = widget.interval() !== interval
      if (symbolChanged) widget.setSymbol(symbol, exchange)
      if (intervalChanged) widget.setInterval(interval)
      const nextType = mode === 'option' ? 'line' : 'candlestick'
      if (widget.chartType() !== nextType) widget.setChartType(nextType)
      const nextScope = feedScopeKey(contextRef.current)
      if (widget.variant()?.unit !== nextScope) widget.setDataVariant({ unit: nextScope })
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Unable to update chart')
    })
  }, [widgetReady, market, mode, index, strike, side, cryptoExchange, date, expiry, interval])

  useEffect(() => {
    if (!widgetReady) return
    const widget = widgetRef.current
    if (widget) void widget.ready.then(() => {
      if (!widget.isDestroyed && widget.theme() !== theme) widget.setTheme(theme)
    })
  }, [theme, widgetReady])

  useEffect(() => {
    if (!widgetReady) return
    const stored: SavedContext = {
      market, mode, index, strike, side, cryptoExchange, date, expiry, interval, theme,
    }
    try {
      window.localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(stored))
    } catch {
      setMessage('Browser storage is unavailable; current session preferences will not persist')
    }
  }, [widgetReady, market, mode, index, strike, side, cryptoExchange, date, expiry, interval, theme])

  const latest = feed?.latest
  const tone = feed?.source === 'demo' ? 'warning'
    : feed?.source === 'empty' || feed?.source === 'unsupported' ? 'muted' : 'positive'
  const today = market === 'BTC' ? todayUTC() : todayIST()
  const providerLabel = market === 'BTC'
    ? (cryptoExchange === 'BINANCE' ? 'BINANCE SPOT' : 'OKX SPOT')
    : 'DATABASE CONNECTED'

  function chooseUnderlying(next: IndexName) {
    setMarket('INDEX')
    setMode('underlying')
    setIndex(next)
    setInterval('5m')
    setFeed(undefined)
  }

  function chooseOption(nextSide: OptionSide) {
    setMarket('INDEX')
    setMode('option')
    setSide(nextSide)
    setInterval('1m')
    setFeed(undefined)
  }

  function chooseCrypto(exchange: CryptoExchange = cryptoExchange) {
    setMarket('BTC')
    setMode('underlying')
    setCryptoExchange(exchange)
    setDate(todayUTC())
    setInterval('5m')
    setFeed(undefined)
    setRealtimeStatus({ state: 'disconnected' })
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="app-header">
        <a className="brand" href="#">
          <span className="brand-mark">T</span>
          <span className="brand-copy">
            <strong>TradeThesis <i>Charts</i></strong>
            <small>CONVICTION BEFORE EXECUTION</small>
          </span>
        </a>
        <div className="header-meta">
          <span className={'connection-pill ' + apiState}>
            <span className="connection-dot" />
            {market === 'BTC'
              ? (apiState === 'connected' ? providerLabel : apiState === 'offline' ? 'EXCHANGE DATA OFFLINE' : 'CONNECTING EXCHANGE')
              : (apiState === 'connected' ? 'DATABASE CONNECTED' : apiState === 'offline' ? 'BACKEND OFFLINE' : 'CONNECTING')}
          </span>
          <span className="local-label">LOCAL WORKSTATION</span>
          <button className="theme-toggle" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            <span>{theme === 'light' ? '◐' : '☼'}</span>{theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      <section className="toolbar">
        <div className="toolbar-group">
          <span className="toolbar-caption">MARKET</span>
          <div className="segmented">
            <button className={market === 'INDEX' && index === 'NIFTY' && mode === 'underlying' ? 'selected' : ''} onClick={() => chooseUnderlying('NIFTY')}>NIFTY</button>
            <button className={market === 'INDEX' && index === 'SENSEX' && mode === 'underlying' ? 'selected' : ''} onClick={() => chooseUnderlying('SENSEX')}>SENSEX</button>
            <button className={market === 'BTC' ? 'selected' : ''} onClick={() => chooseCrypto()}>BTC</button>
          </div>
        </div>
        {market === 'BTC' && <>
          <span className="toolbar-divider" />
          <label className="toolbar-group">
            <span className="toolbar-caption">EXCHANGE</span>
            <select className="control-select" value={cryptoExchange}
              onChange={(event) => chooseCrypto(event.target.value as CryptoExchange)}>
              <option value="BINANCE">Binance</option>
              <option value="OKX">OKX</option>
            </select>
          </label>
        </>}
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <span className="toolbar-caption">SERIES</span>
          <div className="segmented">
            {market === 'BTC'
              ? <button className="selected">Spot</button>
              : <>
                <button className={mode === 'underlying' ? 'selected' : ''} onClick={() => chooseUnderlying(index)}>Underlying</button>
                <button className={mode === 'option' && side === 'CE' ? 'selected call' : ''} onClick={() => chooseOption('CE')}>Call</button>
                <button className={mode === 'option' && side === 'PE' ? 'selected put' : ''} onClick={() => chooseOption('PE')}>Put</button>
              </>}
          </div>
        </div>
        {mode === 'option' && market === 'INDEX' && <>
          <span className="toolbar-divider" />
          <label className="toolbar-group">
            <span className="toolbar-caption">STRIKE</span>
            <select className="control-select strike-select" value={strike} disabled={!strikes.length}
              onChange={(event) => setStrike(Number(event.target.value))}>
              {strikes.length ? strikes.map((value) => <option key={value} value={value}>{fmtInt(value)}</option>)
                : <option value={strike}>{fmtInt(strike)}</option>}
            </select>
          </label>
          <label className="toolbar-group">
            <span className="toolbar-caption">EXPIRY</span>
            <select className="control-select expiry-select" value={expiry}
              onChange={(event) => setExpiry(event.target.value)}>
              {expiryChoices.map((value) => (
                <option key={value} value={value}>{value === 'UNKNOWN' ? 'Legacy / unknown' : value}</option>
              ))}
            </select>
          </label>
        </>}
        <span className="toolbar-spacer" />
        <label className="toolbar-group">
          <span className="toolbar-caption">{market === 'BTC' ? 'DATE (UTC)' : 'SESSION'}</span>
          <input className="control-input" type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button className="today-button" disabled={date === today} onClick={() => setDate(today)}>Today</button>
      </section>

      <section className="status-strip">
        <div className={'source-indicator ' + tone}><span className="source-dot" /><strong>{feed?.label ?? 'Waiting for chart history'}</strong></div>
        <span className="status-detail">{feed?.detail ?? (market === 'BTC' ? 'Public BTC/USDT spot history and live market data' : 'Connect the local Options Dashboard API to load saved market data')}</span>
        <span className="status-spacer" />
        <span>{market === 'BTC' ? '24/7 SPOT MARKET' : `${dates.length} saved sessions`}</span>
        <span className="status-divider" />
        <span className="status-live">{realtimeStatus.state === 'live' ? 'REALTIME STREAM CONNECTED' : realtimeStatus.state === 'connecting' ? 'CONNECTING LIVE STREAM' : realtimeStatus.state === 'reconnecting' ? 'RECONNECTING LIVE STREAM' : 'HISTORICAL MODE'}</span>
      </section>

      <section className="workspace">
        <div className="chart-heading">
          <div>
            <span className="eyebrow">{market === 'BTC' ? 'BITCOIN SPOT' : mode === 'option' ? 'OPTION PREMIUM' : 'INDEX SPOT'}</span>
            <h1>{market === 'BTC'
              ? 'BTC/USDT'
              : mode === 'option' ? index + ' ' + fmtInt(strike) + ' ' + side : index}
              <small>{market === 'BTC' ? cryptoExchange : exchangeFor(index, mode === 'option')}</small>
            </h1>
            <p>{market === 'BTC'
              ? 'Exchange-specific spot OHLCV · 24/7 market · no account credentials'
              : mode === 'option'
                ? (expiry === 'UNKNOWN' ? 'Sampled LTP observations · historical expiry unknown' : 'Sampled LTP observations · expiry ' + expiry)
                : 'Tick-built underlying OHLC · cash volume unavailable'}</p>
          </div>
          <div className="chart-meta">
            <strong>{date}</strong>
            <span>{market === 'BTC' ? 'UTC CANDLE SOURCE' : mode === 'option' ? '≈ 30 SEC SNAPSHOT CADENCE' : 'TICK-BUILT CANDLE SOURCE'}</span>
          </div>
        </div>
        <div className="chart-frame">
          <div ref={chartRef} className="chart-host" aria-label="Interactive market chart" />
        </div>
        {mode === 'option' && market === 'INDEX' && <div className="metrics-bar">
          <Metric label="LAST PREMIUM" value={fmt(latest?.ltp)} />
          <Metric label="OPEN INTEREST" value={fmtInt(latest?.oi)} />
          <Metric label="OI CHANGE" value={fmtInt(latest?.oiChange)} />
          <Metric label="IMPLIED VOL." value={fmt(latest?.iv)} />
          <Metric label="DELTA" value={fmt(latest?.delta, 3)} />
          <Metric label="GAMMA" value={fmt(latest?.gamma, 5)} />
          <Metric label="THETA" value={fmt(latest?.theta, 3)} />
          <Metric label="VEGA" value={fmt(latest?.vega, 3)} />
        </div>}
        <div className="chart-footnote">
          <span>TRADETHESIS CHARTING ENGINE</span>
          <span>{message}</span>
          <span>{feed?.barCount ?? 0} plotted observations</span>
        </div>
      </section>

      <footer className="app-footer">
        <div><strong>TRADETHESIS CHARTS</strong><span>Local-first analysis. No order execution.</span></div>
        <p>{market === 'BTC'
          ? 'BTC/USDT spot data is sourced from the selected exchange. Exchange prices and volumes may differ; charts use UTC timestamps.'
          : mode === 'option'
            ? 'Option prices are sampled observations, not tick-perfect OHLC. Legacy rows remain separate from expiry-specific history.'
            : 'Underlying OHLC is loaded from the Options Dashboard candle store. Cash index volume is unavailable.'}</p>
        <span className="version-label">EARLY ACCESS · 0.1.0</span>
      </footer>
    </main>
  )
}
