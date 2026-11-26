import { useEffect, useRef, useState } from 'react'
import { createWidget } from 'openalgo-charts/widget'
import 'openalgo-charts/indicators'
import { fetchAvailableDates, fetchAvailableExpiries, fetchStrikesForDate, type IndexName, type OptionSide } from './api'
import { optionSymbol, parseOptionSymbol } from './data'
import { TradeThesisDataFeed, type FeedContext, type FeedResult } from './feed'
import type { RealtimeStatus } from './realtime'

type Mode = 'underlying' | 'option'
type Theme = 'light' | 'dark'

function todayIST(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return String(values.year) + '-' + String(values.month) + '-' + String(values.day)
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

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>
}

export default function App() {
  const [mode, setMode] = useState<Mode>('underlying')
  const [index, setIndex] = useState<IndexName>('NIFTY')
  const [strike, setStrike] = useState(25000)
  const [side, setSide] = useState<OptionSide>('CE')
  const [date, setDate] = useState(todayIST)
  const [expiry, setExpiry] = useState('UNKNOWN')
  const [expiryChoices, setExpiryChoices] = useState<string[]>(['UNKNOWN'])
  const [interval, setInterval] = useState('5m')
  const [theme, setTheme] = useState<Theme>('light')
  const [apiState, setApiState] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [dates, setDates] = useState<string[]>([])
  const [strikes, setStrikes] = useState<number[]>([])
  const [feed, setFeed] = useState<FeedResult | undefined>()
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>({ state: 'disconnected' })
  const [message, setMessage] = useState('Checking local data service')
  const chartRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<ReturnType<typeof createWidget> | null>(null)
  const contextRef = useRef<FeedContext>({
    index, strike, side, date, expiry, onResult: setFeed, onLiveStatus: setRealtimeStatus,
  })
  contextRef.current = { index, strike, side, date, expiry, onResult: setFeed, onLiveStatus: setRealtimeStatus }

  useEffect(() => {
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
  }, [index])

  useEffect(() => {
    if (mode !== 'option') return
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
  }, [mode, index, date])

  useEffect(() => {
    if (mode !== 'option') return
    const controller = new AbortController()
    fetchStrikesForDate(index, date, controller.signal).then((available) => {
      if (controller.signal.aborted) return
      setStrikes(available)
      if (available.length && !available.includes(strike)) {
        setStrike(available[Math.floor(available.length / 2)])
      }
    }).catch(() => {
      if (!controller.signal.aborted) setStrikes([])
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, index, date])

  useEffect(() => {
    const container = chartRef.current
    if (!container) return
    const widget = createWidget(container, {
      feed: new TradeThesisDataFeed(() => contextRef.current),
      symbol: 'NIFTY',
      exchange: 'NSE',
      interval: '5m',
      intervals: ['1m', '5m', '15m', '30m', '1h'],
      canSelectInterval: (code) => {
        const isOption = parseOptionSymbol(widgetRef.current?.symbol() ?? '') !== undefined
        return isOption ? code === '1m' : ['5m', '15m', '30m', '1h'].includes(code)
      },
      theme: 'light',
      chartType: 'candlestick',
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
      widget.on('symbol', ({ symbol }) => {
        const contract = parseOptionSymbol(symbol)
        if (contract) {
          setMode('option')
          setIndex(contract.index)
          setStrike(contract.strike)
          setSide(contract.side)
        } else if (symbol === 'NIFTY' || symbol === 'SENSEX') {
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
        setMode('option')
        setIndex(contract.index)
        setStrike(contract.strike)
        setSide(contract.side)
      } else if (widget.symbol() === 'NIFTY' || widget.symbol() === 'SENSEX') {
        setIndex(widget.symbol() as IndexName)
      }
    })
    return () => {
      off.forEach((unsubscribe) => unsubscribe())
      widget.destroy()
      if (widgetRef.current === widget) widgetRef.current = null
    }
  }, [])

  const previousRef = useRef({ mode, index, strike, side, date, expiry, interval })
  useEffect(() => {
    const widget = widgetRef.current
    if (!widget) return
    const previous = previousRef.current
    previousRef.current = { mode, index, strike, side, date, expiry, interval }
    void widget.ready.then(() => {
      if (widget.isDestroyed) return
      const symbol = mode === 'option' ? optionSymbol(index, strike, side) : index
      const exchange = exchangeFor(index, mode === 'option')
      const symbolChanged = widget.symbol() !== symbol || widget.exchange() !== exchange
      const intervalChanged = widget.interval() !== interval
      if (symbolChanged) widget.setSymbol(symbol, exchange)
      if (intervalChanged) widget.setInterval(interval)
      const nextType = mode === 'option' ? 'line' : 'candlestick'
      if (widget.chartType() !== nextType) widget.setChartType(nextType)
      if (!symbolChanged && !intervalChanged && (previous.date !== date || previous.expiry !== expiry)) void widget.reload()
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Unable to update chart')
    })
  }, [mode, index, strike, side, date, expiry, interval])

  useEffect(() => {
    const widget = widgetRef.current
    if (widget) void widget.ready.then(() => {
      if (!widget.isDestroyed && widget.theme() !== theme) widget.setTheme(theme)
    })
  }, [theme])

  const latest = feed?.latest
  const tone = feed?.source === 'demo' ? 'warning'
    : feed?.source === 'empty' || feed?.source === 'unsupported' ? 'muted' : 'positive'

  function chooseUnderlying(next: IndexName) {
    setMode('underlying')
    setIndex(next)
    setInterval('5m')
  }

  function chooseOption(nextSide: OptionSide) {
    setMode('option')
    setSide(nextSide)
    setInterval('1m')
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
            {apiState === 'connected' ? 'DATABASE CONNECTED' : apiState === 'offline' ? 'BACKEND OFFLINE' : 'CONNECTING'}
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
            <button className={index === 'NIFTY' && mode === 'underlying' ? 'selected' : ''} onClick={() => chooseUnderlying('NIFTY')}>NIFTY</button>
            <button className={index === 'SENSEX' && mode === 'underlying' ? 'selected' : ''} onClick={() => chooseUnderlying('SENSEX')}>SENSEX</button>
          </div>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <span className="toolbar-caption">SERIES</span>
          <div className="segmented">
            <button className={mode === 'underlying' ? 'selected' : ''} onClick={() => chooseUnderlying(index)}>Underlying</button>
            <button className={mode === 'option' && side === 'CE' ? 'selected call' : ''} onClick={() => chooseOption('CE')}>Call</button>
            <button className={mode === 'option' && side === 'PE' ? 'selected put' : ''} onClick={() => chooseOption('PE')}>Put</button>
          </div>
        </div>
        {mode === 'option' && <>
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
          <span className="toolbar-caption">SESSION</span>
          <input className="control-input" type="date" value={date} max={todayIST()} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button className="today-button" disabled={date === todayIST()} onClick={() => setDate(todayIST())}>Today</button>
      </section>

      <section className="status-strip">
        <div className={'source-indicator ' + tone}><span className="source-dot" /><strong>{feed?.label ?? 'Waiting for chart history'}</strong></div>
        <span className="status-detail">{feed?.detail ?? 'Connect the local Options Dashboard API to load saved market data'}</span>
        <span className="status-spacer" />
        <span>{dates.length} saved sessions</span>
        <span className="status-divider" />
        <span className="status-live">{realtimeStatus.state === 'live' ? 'REALTIME STREAM CONNECTED' : realtimeStatus.state === 'connecting' ? 'CONNECTING LIVE STREAM' : realtimeStatus.state === 'reconnecting' ? 'RECONNECTING LIVE STREAM' : 'HISTORICAL MODE'}</span>
      </section>

      <section className="workspace">
        <div className="chart-heading">
          <div>
            <span className="eyebrow">{mode === 'option' ? 'OPTION PREMIUM' : 'INDEX SPOT'}</span>
            <h1>{mode === 'option' ? index + ' ' + fmtInt(strike) + ' ' + side : index}
              <small>{exchangeFor(index, mode === 'option')}</small>
            </h1>
            <p>{mode === 'option'
              ? (expiry === 'UNKNOWN' ? 'Sampled LTP observations · historical expiry unknown' : 'Sampled LTP observations · expiry ' + expiry)
              : 'Tick-built underlying OHLC · cash volume unavailable'}</p>
          </div>
          <div className="chart-meta">
            <strong>{date}</strong>
            <span>{mode === 'option' ? '≈ 30 SEC SNAPSHOT CADENCE' : 'TICK-BUILT CANDLE SOURCE'}</span>
          </div>
        </div>
        <div className="chart-frame">
          <div ref={chartRef} className="chart-host" aria-label="Interactive market chart" />
        </div>
        {mode === 'option' && <div className="metrics-bar">
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
        <p>{mode === 'option'
          ? 'Option prices are sampled observations, not tick-perfect OHLC. Legacy rows remain separate from expiry-specific history.'
          : 'Underlying OHLC is loaded from the Options Dashboard candle store. Cash index volume is unavailable.'}</p>
        <span className="version-label">EARLY ACCESS · 0.1.0</span>
      </footer>
    </main>
  )
}
