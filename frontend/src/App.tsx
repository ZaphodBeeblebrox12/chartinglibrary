import { useEffect, useRef, useState } from 'react'
import { createChartGrid, type ChartGrid, type ChartGridLayoutId } from 'openalgo-charts/widget'
import { WorkspaceRepository, createIndexedDbWorkspaceStorage } from 'openalgo-charts/workspace'
import 'openalgo-charts/indicators'
import {
  fetchAvailableDates,
  fetchAvailableExpiries,
  fetchOptionChain,
  fetchOptionHistory,
  fetchStrikesForDate,
  fetchTrackedCashInstruments,
  fetchGlobalMarketInstruments,
  type TrackedCashInstrument,
  type GlobalAssetType,
  type GlobalMarketInstrument,
  type CryptoExchange,
  type IndexName,
  type OptionChainResponse,
  type OptionHistoryPoint,
  type OptionSide,
} from './api'
import { feedScopeKey, TradeThesisDataFeed, type FeedContext, type FeedResult } from './feed'
import { optionSymbol, parseOptionSymbol } from './data'
import type { RealtimeStatus } from './realtime'
import { OptionsDashboardRealtimeProvider } from './options-realtime'
import { OptionAnalyticsPanel } from './analytics-panels'
import { ChartAlertsPanel } from './chart-alerts'
import type { OptionMetrics } from './data'

type Mode = 'underlying' | 'option'
type Theme = 'light' | 'dark'
type Market = 'INDEX' | 'STOCK' | 'COMMODITY' | 'GLOBAL' | 'BTC'

interface SavedContext {
  market?: Market
  mode?: Mode
  index?: IndexName
  strike?: number
  side?: OptionSide
  cryptoExchange?: CryptoExchange
  selectedCashInstrument?: string
  selectedCashExchange?: string
  globalSymbol?: string
  globalType?: GlobalAssetType
  date?: string
  expiry?: string
  interval?: string
  theme?: Theme
}

const CONTEXT_STORAGE_KEY = 'tradethesis-charts-context-v1'
const WORKSPACES_STORAGE_KEY = 'tradethesis-charts-workspaces-v1'

interface SavedWorkspace {
  context: SavedContext
  grid?: ReturnType<ChartGrid['getWorkspace']>
}

function readWorkspaces(): Record<string, SavedWorkspace> {
  try {
    const raw = window.localStorage.getItem(WORKSPACES_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as Record<string, SavedContext | SavedWorkspace> : {}
    return Object.fromEntries(Object.entries(parsed).map(([name, value]) => {
      // Migrate the earlier context-only workspace format without dropping it.
      if (value && typeof value === 'object' && 'context' in value) {
        return [name, value as SavedWorkspace]
      }
      return [name, { context: value as SavedContext }]
    }))
  } catch {
    return {}
  }
}

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
  const [cashInstruments, setCashInstruments] = useState<TrackedCashInstrument[]>([])
  const [selectedCashInstrument, setSelectedCashInstrument] = useState(saved.selectedCashInstrument ?? '')
  const [selectedCashExchange, setSelectedCashExchange] = useState(saved.selectedCashExchange ?? 'NSE')
  const [globalInstruments, setGlobalInstruments] = useState<GlobalMarketInstrument[]>([])
  const [globalSymbol, setGlobalSymbol] = useState(saved.globalSymbol ?? 'EURUSD')
  const [globalType, setGlobalType] = useState<GlobalAssetType>(saved.globalType ?? 'Forex')
  const [globalSearch, setGlobalSearch] = useState('')
  const [date, setDate] = useState(saved.date ?? (saved.market === 'BTC' || saved.market === 'GLOBAL' ? todayUTC() : todayIST()))
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
  const [liveMetrics, setLiveMetrics] = useState<OptionMetrics | undefined>()
  const [callHistory, setCallHistory] = useState<OptionHistoryPoint[]>([])
  const [putHistory, setPutHistory] = useState<OptionHistoryPoint[]>([])
  const [chain, setChain] = useState<OptionChainResponse | undefined>()
  const [workspaces, setWorkspaces] = useState<Record<string, SavedWorkspace>>(readWorkspaces)
  const [gridPreset, setGridPreset] = useState<ChartGridLayoutId>('1x1')
  const [workspaceName, setWorkspaceName] = useState('')
  const [activeWorkspace, setActiveWorkspace] = useState('')
  const chartRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<ChartGrid | null>(null)
  const cellSubscriptions = useRef(new Map<string, Array<() => void>>())

  const mergeLiveMetrics = (metrics: OptionMetrics) => {
    setLiveMetrics(previous => ({ ...previous, ...metrics }))
  }

  const onFeedResult = (result: FeedResult) => {
    setFeed(result)
    if (result.connection === 'connected') setApiState('connected')
    if (result.connection === 'offline') setApiState('offline')
  }

  const contextRef = useRef<FeedContext>({
    market,
    mode,
    cryptoExchange,
    selectedCashInstrument,
    selectedCashExchange,
    cashInstruments,
    globalSymbol,
    globalInstruments,
    index,
    strike,
    side,
    date,
    expiry,
    interval,
    theme,
    onResult: onFeedResult,
    onLiveStatus: setRealtimeStatus,
    onLiveMetrics: mergeLiveMetrics,
  })
  contextRef.current = {
    market,
    mode,
    cryptoExchange,
    selectedCashInstrument,
    selectedCashExchange,
    cashInstruments,
    globalSymbol,
    globalInstruments,
    index,
    strike,
    side,
    date,
    expiry,
    interval,
    theme,
    onResult: onFeedResult,
    onLiveStatus: setRealtimeStatus,
    onLiveMetrics: mergeLiveMetrics,
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchTrackedCashInstruments(controller.signal).then(items => {
      if (!controller.signal.aborted) {
        setCashInstruments(items)
        setSelectedCashInstrument(current => current || items[0]?.name || '')
        setSelectedCashExchange(current => current || items[0]?.exchange || 'NSE')
      }
    }).catch(() => {
      if (!controller.signal.aborted) setCashInstruments([])
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchGlobalMarketInstruments(controller.signal).then(items => {
      if (controller.signal.aborted) return
      setGlobalInstruments(items)
      setGlobalSymbol(current => current || items[0]?.name || 'EURUSD')
      if (!items.some(item => item.name === globalSymbol) && items.length) {
        const preferred = items.find(item => item.name === 'EURUSD') ?? items[0]
        setGlobalSymbol(preferred.name)
        setGlobalType(preferred.type)
      }
    }).catch(error => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Biquote catalogue unavailable')
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (market === 'BTC') {
      setDates([])
      setApiState('checking')
      setMessage(`Connecting to ${cryptoExchange} public BTC/USDT market data`)
      return
    }
    if (market === 'STOCK' || market === 'COMMODITY') {
      setDates([])
      setApiState('connected')
      setMessage(market === 'COMMODITY'
        ? `${cashInstruments.filter(item => item.kind === 'COMMODITY').length} configured MCX futures instruments available`
        : `${cashInstruments.filter(item => item.kind === 'STOCK').length} configured NSE cash instruments available`)
      return
    }
    if (market === 'GLOBAL') {
      setDates([])
      setApiState(globalInstruments.length ? 'connected' : 'offline')
      setMessage(globalInstruments.length
        ? 'Biquote global market catalogue ready'
        : 'Biquote global market catalogue unavailable')
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
  }, [market, index, cryptoExchange, cashInstruments.length, globalInstruments.length])

  useEffect(() => {
    if (market !== 'INDEX') return
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
  }, [market, index, date])

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
    if (market !== 'INDEX') {
      setCallHistory([])
      setPutHistory([])
      setChain(undefined)
      return
    }
    const controller = new AbortController()
    setChain(undefined)
    const histories = mode === 'option'
      ? Promise.all([
          fetchOptionHistory(index, strike, 'CE', expiry, date, controller.signal),
          fetchOptionHistory(index, strike, 'PE', expiry, date, controller.signal),
        ])
      : Promise.resolve([{ points: [] }, { points: [] }] as const)
    Promise.all([
      histories,
      fetchOptionChain(index, expiry, date, controller.signal),
    ]).then(([[ce, pe], chainResult]) => {
      if (controller.signal.aborted) return
      setCallHistory(ce.points)
      setPutHistory(pe.points)
      setChain(chainResult)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setCallHistory([])
      setPutHistory([])
      setChain(undefined)
      setMessage(error instanceof Error ? error.message : 'Unable to load option analytics')
    })
    return () => controller.abort()
  }, [market, mode, index, strike, date, expiry])

  useEffect(() => {
    const container = chartRef.current
    if (!container) return
    const initial = contextRef.current
    const initialSymbol = initial.market === 'BTC'
      ? cryptoSymbol(initial.cryptoExchange)
      : initial.market === 'GLOBAL'
        ? initial.globalSymbol
        : initial.market === 'STOCK' || initial.market === 'COMMODITY'
          ? initial.selectedCashInstrument
          : initial.mode === 'option'
        ? optionSymbol(initial.index, initial.strike, initial.side, initial.expiry)
        : initial.index
    const initialExchange = initial.market === 'BTC'
      ? initial.cryptoExchange
      : initial.market === 'GLOBAL'
        ? 'BIQUOTE'
        : initial.market === 'COMMODITY'
          ? 'MCX'
          : initial.market === 'STOCK'
            ? initial.selectedCashExchange
            : exchangeFor(initial.index, initial.mode === 'option')

    const grid = createChartGrid(container, {
      feed: ({ id }) => new TradeThesisDataFeed(
        () => ({
          ...contextRef.current,
          onResult: (result) => { if (gridRef.current?.active().id === id) onFeedResult(result) },
          onLiveStatus: (status) => { if (gridRef.current?.active().id === id) setRealtimeStatus(status) },
          onLiveMetrics: (metrics) => { if (gridRef.current?.active().id === id) mergeLiveMetrics(metrics) },
        }),
        new OptionsDashboardRealtimeProvider(
          () => contextRef.current.date,
          (metrics) => {
            if (gridRef.current?.active().id === id) mergeLiveMetrics(metrics)
          },
        ),
      ),
      symbol: initialSymbol,
      exchange: initialExchange,
      interval: initial.interval ?? '5m',
      variant: { unit: feedScopeKey(initial) },
      intervals: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'],
      canSelectInterval: (code) => {
        const exchange = gridRef.current?.active().widget.exchange().toUpperCase() ?? initialExchange.toUpperCase()
        const activeSymbol = gridRef.current?.active().widget.symbol() ?? initialSymbol
        const option = parseOptionSymbol(activeSymbol) !== undefined
        if (option) return code === '1m'
        if (exchange === 'BINANCE' || exchange === 'OKX') {
          const allowed = exchange === 'BINANCE'
            ? ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d']
            : ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d']
          return allowed.includes(code)
        }
        if (exchange === 'BIQUOTE') return ['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(code)
        return ['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(code)
      },
      workspaces: (() => {
        try {
          return new WorkspaceRepository(
            createIndexedDbWorkspaceStorage(window.indexedDB),
            'tradethesis-charts',
          )
        } catch {
          setMessage('IndexedDB workspace storage is unavailable')
          return undefined
        }
      })(),
      theme: initial.theme ?? 'light',
      chartType: initial.mode === 'option' ? 'line' : 'candlestick',
      preset: '1x1',
      links: { crosshair: true, viewport: true },
      toolbar: true,
      persist: 'tradethesis-chart-grid-v1',
      rail: true,
      topbar: true,
      fullscreen: true,
      drawingScope: 'instrument',
      lookbackBars: 1200,
      mobile: 'never',
    })
    gridRef.current = grid

    const syncActiveContext = () => {
      if (grid.isDestroyed) return
      const widget = grid.active().widget
      const symbol = widget.symbol()
      const exchange = widget.exchange().toUpperCase()
      const contract = parseOptionSymbol(symbol)
      if (contract) {
        setMarket('INDEX'); setMode('option'); setIndex(contract.index)
        setStrike(contract.strike); setSide(contract.side)
        if (contract.expiry) setExpiry(contract.expiry)
      } else if (exchange === 'BINANCE' || exchange === 'OKX' || symbol === 'BTCUSDT' || symbol === 'BTC-USDT') {
        setMarket('BTC'); setMode('underlying')
        setCryptoExchange(exchange === 'OKX' ? 'OKX' : 'BINANCE')
      } else if (exchange === 'BIQUOTE') {
        setMarket('GLOBAL'); setMode('underlying')
        setGlobalSymbol(symbol)
        const match = globalInstruments.find(item => item.name === symbol)
        if (match) setGlobalType(match.type)
      } else if (symbol === 'NIFTY' || symbol === 'SENSEX') {
        setMarket('INDEX'); setMode('underlying'); setIndex(symbol)
      } else if (exchange === 'MCX') {
        setMarket('COMMODITY'); setMode('underlying')
        setSelectedCashInstrument(symbol)
        setSelectedCashExchange('MCX')
      } else if (['NSE', 'BSE'].includes(exchange)) {
        setMarket('STOCK'); setMode('underlying')
        setSelectedCashInstrument(symbol)
        setSelectedCashExchange(exchange)
      }
      const restoredDate = dateFromVariant(widget.variant()?.unit)
      if (restoredDate) setDate(restoredDate)
      setInterval(widget.interval())
      setTheme(widget.theme())
      setLiveMetrics(undefined)
      setFeed(undefined)
      setRealtimeStatus({ state: 'disconnected' })
    }

    const attachCell = (cell: ReturnType<ChartGrid['cells']>[number]) => {
      if (cellSubscriptions.current.has(cell.id)) return
      cellSubscriptions.current.set(cell.id, [
        cell.widget.on('symbol', () => { if (gridRef.current?.active().id === cell.id) syncActiveContext() }),
        cell.widget.on('interval', ({ interval: next }) => { if (gridRef.current?.active().id === cell.id) setInterval(next) }),
        cell.widget.on('theme', ({ theme: next }) => { if (gridRef.current?.active().id === cell.id) setTheme(next) }),
        cell.widget.on('data', ({ bars, error }) => {
          if (gridRef.current?.active().id !== cell.id) return
          if (error) setMessage(error)
          else if (bars > 0) setMessage('Chart history loaded')
        }),
      ])
    }
    const attachAllCells = () => {
      const activeIds = new Set(grid.cells().map(cell => cell.id))
      for (const [id, off] of cellSubscriptions.current) {
        if (!activeIds.has(id)) { off.forEach(unsubscribe => unsubscribe()); cellSubscriptions.current.delete(id) }
      }
      grid.cells().forEach(attachCell)
    }
    attachAllCells()
    const offActive = grid.on('active', () => { attachAllCells(); syncActiveContext() })
    const offLayout = grid.on('layout', attachAllCells)

    void grid.ready.then(() => {
      if (grid.isDestroyed) return
      attachAllCells()
      setWidgetReady(true)
      syncActiveContext()
      const activePreset = grid.layout().preset
      if (activePreset) setGridPreset(activePreset as ChartGridLayoutId)
    })
    return () => {
      offActive(); offLayout()
      for (const off of cellSubscriptions.current.values()) off.forEach(unsubscribe => unsubscribe())
      cellSubscriptions.current.clear()
      grid.destroy()
      if (gridRef.current === grid) gridRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!widgetReady) return
    const grid = gridRef.current
    if (!grid) return
    const widget = grid.active().widget
    void widget.ready.then(() => {
      if (grid.isDestroyed) return
      const symbol = market === 'BTC'
        ? cryptoSymbol(cryptoExchange)
        : market === 'GLOBAL'
          ? globalSymbol
          : market === 'STOCK' || market === 'COMMODITY'
            ? selectedCashInstrument
            : mode === 'option'
            ? optionSymbol(index, strike, side, expiry)
            : index
      const exchange = market === 'BTC'
        ? cryptoExchange
        : market === 'GLOBAL'
          ? 'BIQUOTE'
          : market === 'COMMODITY'
            ? 'MCX'
            : market === 'STOCK'
              ? selectedCashExchange
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
  }, [widgetReady, market, mode, index, strike, side, cryptoExchange, selectedCashInstrument, selectedCashExchange, globalSymbol, date, expiry, interval])

  useEffect(() => {
    if (!widgetReady) return
    const grid = gridRef.current
    const widget = grid?.active().widget
    if (widget) void widget.ready.then(() => {
      if (!grid?.isDestroyed && widget.theme() !== theme) widget.setTheme(theme)
    })
  }, [theme, widgetReady])

  useEffect(() => {
    if (!widgetReady || market !== 'INDEX' || mode !== 'underlying' || !chain) return
    const grid = gridRef.current
    if (!grid) return
    const widget = grid.active().widget
    if (!['NSE', 'BSE'].includes(widget.exchange().toUpperCase())) return

    const now = Math.floor(Date.now() / 1000)
    const levels = [
      { id: 'tradethesis-call-oi-wall', label: 'CALL OI WALL', value: chain.analytics.call_wall, color: '#16a36a' },
      { id: 'tradethesis-put-oi-wall', label: 'PUT OI WALL', value: chain.analytics.put_wall, color: '#db4c5a' },
      { id: 'tradethesis-max-pain', label: 'MAX PAIN', value: chain.analytics.max_pain, color: '#d99a28' },
      { id: 'tradethesis-gamma-flip', label: 'GAMMA FLIP', value: chain.analytics.gamma_flip, color: '#8b63c7' },
      { id: 'tradethesis-max-gex', label: 'MAX GEX STRIKE', value: chain.analytics.max_gex_strike, color: '#397dd4' },
    ].filter((level): level is typeof level & { value: number } =>
      typeof level.value === 'number' && Number.isFinite(level.value) && level.value > 0,
    )

    // Dynamic analytical levels are real chart drawings, not HTML lines.
    // They are read-only/transient so they follow the selected date/expiry
    // but do not overwrite the trader's own drawings in the instrument store.
    for (const level of levels) {
      const existing = widget.draw.get(level.id)
      if (existing) widget.draw.remove(level.id, { force: true })
      widget.draw.add({
        id: level.id,
        tool: 'horizontal-line',
        paneIndex: 0,
        points: [{ time: now, price: level.value }],
        style: { color: level.color, lineWidth: 1.5, lineStyle: 'dashed', showLabels: true },
        text: { value: level.label, color: level.color, position: 'right' },
        policy: { editable: false, persistent: false, listed: false },
      })
    }

    return () => {
      for (const level of levels) {
        if (widget.draw.get(level.id)) widget.draw.remove(level.id, { force: true })
      }
    }
  }, [widgetReady, market, mode, chain])

  useEffect(() => {
    if (!widgetReady) return
    const stored: SavedContext = {
      market, mode, index, strike, side, cryptoExchange, selectedCashInstrument, selectedCashExchange, globalSymbol, globalType, date, expiry, interval, theme,
    }
    try {
      window.localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(stored))
    } catch {
      setMessage('Browser storage is unavailable; current session preferences will not persist')
    }
  }, [widgetReady, market, mode, index, strike, side, cryptoExchange, selectedCashInstrument, selectedCashExchange, globalSymbol, globalType, date, expiry, interval, theme])

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces))
    } catch {
      setMessage('Workspace storage is unavailable in this browser')
    }
  }, [workspaces])

  function saveWorkspace() {
    const name = workspaceName.trim()
    if (!name) return
    const snapshot: SavedContext = {
      market, mode, index, strike, side, cryptoExchange,
      selectedCashInstrument, selectedCashExchange,
      globalSymbol, globalType,
      date, expiry, interval, theme,
    }
    const currentGrid = gridRef.current
    if (!currentGrid) return
    setWorkspaces(previous => ({ ...previous, [name]: {
      context: snapshot,
      grid: currentGrid.getWorkspace(),
    } }))
    setActiveWorkspace(name)
    setWorkspaceName('')
  }

  function loadWorkspace(name: string) {
    const savedWorkspace = workspaces[name]
    if (!savedWorkspace) return
    const snapshot = savedWorkspace.context
    setMarket(snapshot.market ?? 'INDEX')
    setMode(snapshot.mode ?? 'underlying')
    setIndex(snapshot.index ?? 'NIFTY')
    setStrike(snapshot.strike ?? 25000)
    setSide(snapshot.side ?? 'CE')
    setCryptoExchange(snapshot.cryptoExchange ?? 'BINANCE')
    setSelectedCashInstrument(snapshot.selectedCashInstrument ?? cashInstruments[0]?.name ?? '')
    setSelectedCashExchange(snapshot.selectedCashExchange ?? 'NSE')
    setGlobalSymbol(snapshot.globalSymbol ?? 'EURUSD')
    setGlobalType(snapshot.globalType ?? 'Forex')
    setDate(snapshot.date ?? (snapshot.market === 'GLOBAL' || snapshot.market === 'BTC' ? todayUTC() : todayIST()))
    setExpiry(snapshot.expiry ?? 'UNKNOWN')
    setInterval(snapshot.interval ?? '5m')
    setTheme(snapshot.theme ?? 'light')
    if (savedWorkspace.grid) gridRef.current?.applyWorkspace(savedWorkspace.grid)
    setFeed(undefined)
    setLiveMetrics(undefined)
    setRealtimeStatus({ state: 'disconnected' })
    setActiveWorkspace(name)
  }

  const latest = liveMetrics ?? feed?.latest
  const currentSymbol = market === 'BTC'
    ? cryptoSymbol(cryptoExchange)
    : market === 'GLOBAL'
      ? globalSymbol
      : market === 'STOCK' || market === 'COMMODITY'
        ? selectedCashInstrument
        : mode === 'option'
          ? optionSymbol(index, strike, side, expiry)
          : index
  const tone = feed?.source === 'demo' ? 'warning'
    : feed?.source === 'empty' || feed?.source === 'unsupported' ? 'muted' : 'positive'
  const today = market === 'BTC' || market === 'GLOBAL' ? todayUTC() : todayIST()
  const visibleCashInstruments = cashInstruments.filter(item =>
    market === 'COMMODITY' ? item.kind === 'COMMODITY' : item.kind === 'STOCK'
  )
  const visibleGlobalInstruments = globalInstruments.filter(item =>
    item.type === globalType &&
    (item.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
      item.description.toLowerCase().includes(globalSearch.toLowerCase()))
  ).slice(0, 250)
  const providerLabel = market === 'BTC'
    ? (cryptoExchange === 'BINANCE' ? 'BINANCE SPOT' : 'OKX SPOT')
    : market === 'GLOBAL' ? 'BIQUOTE GLOBAL DATA'
      : market === 'COMMODITY' ? 'MCX FUTURES DATABASE'
        : market === 'STOCK' ? 'CASH DATABASE' : 'DATABASE CONNECTED'

  function chooseUnderlying(next: IndexName) {
    setMarket('INDEX')
    setMode('underlying')
    setIndex(next)
    setInterval('5m')
    setFeed(undefined)
    setLiveMetrics(undefined)
  }

  function chooseOption(nextSide: OptionSide) {
    setMarket('INDEX')
    setMode('option')
    setSide(nextSide)
    setInterval('1m')
    setFeed(undefined)
    setLiveMetrics(undefined)
  }

  function chooseTrackedInstrument(name: string) {
    const instrument = cashInstruments.find(item => item.name === name)
    if (!instrument) return
    setMarket(instrument.kind === 'COMMODITY' ? 'COMMODITY' : 'STOCK')
    setMode('underlying')
    setSelectedCashInstrument(instrument.name)
    setSelectedCashExchange(instrument.exchange)
    setDate(todayIST())
    setInterval('5m')
    setFeed(undefined)
    setLiveMetrics(undefined)
    setRealtimeStatus({ state: 'disconnected' })
  }

  function chooseGlobalInstrument(name: string) {
    const instrument = globalInstruments.find(item => item.name === name)
    if (!instrument) return
    setMarket('GLOBAL')
    setMode('underlying')
    setGlobalSymbol(instrument.name)
    setGlobalType(instrument.type)
    setDate(todayUTC())
    setInterval('5m')
    setFeed(undefined)
    setLiveMetrics(undefined)
    setRealtimeStatus({ state: 'disconnected' })
  }

  function chooseCrypto(exchange: CryptoExchange = cryptoExchange) {
    setMarket('BTC')
    setMode('underlying')
    setCryptoExchange(exchange)
    setDate(todayUTC())
    setInterval('5m')
    setFeed(undefined)
    setLiveMetrics(undefined)
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
              : (apiState === 'connected' ? providerLabel : apiState === 'offline' ? 'DATA SOURCE OFFLINE' : 'CONNECTING')}
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
            <button className={market === 'STOCK' ? 'selected' : ''} disabled={!cashInstruments.some(item => item.kind === 'STOCK')} onClick={() => chooseTrackedInstrument(cashInstruments.find(item => item.kind === 'STOCK')?.name ?? '')}>STOCKS</button>
            <button className={market === 'COMMODITY' ? 'selected' : ''} disabled={!cashInstruments.some(item => item.kind === 'COMMODITY')} onClick={() => chooseTrackedInstrument(cashInstruments.find(item => item.kind === 'COMMODITY')?.name ?? '')}>MCX</button>
            <button className={market === 'GLOBAL' ? 'selected' : ''} onClick={() => chooseGlobalInstrument(globalSymbol || globalInstruments[0]?.name || '')}>GLOBAL</button>
            <button className={market === 'BTC' ? 'selected' : ''} onClick={() => chooseCrypto()}>BTC</button>
          </div>
        </div>
        {(market === 'STOCK' || market === 'COMMODITY') && <>
          <span className="toolbar-divider" />
          <label className="toolbar-group">
            <span className="toolbar-caption">{market === 'COMMODITY' ? 'MCX FRONT-MONTH FUTURE' : 'CASH EQUITY'}</span>
            <select className="control-select stock-select" value={selectedCashInstrument}
              onChange={(event) => chooseTrackedInstrument(event.target.value)}>
              {visibleCashInstruments.map(item => <option key={item.name} value={item.name}>{item.name} · {item.exchange}</option>)}
              {!visibleCashInstruments.length && <option value="">No configured instruments</option>}
            </select>
          </label>
        </>}
        {market === 'GLOBAL' && <>
          <span className="toolbar-divider" />
          <label className="toolbar-group">
            <span className="toolbar-caption">ASSET CLASS</span>
            <select className="control-select" value={globalType}
              onChange={(event) => {
                const type = event.target.value as GlobalAssetType
                setGlobalType(type)
                const first = globalInstruments.find(item => item.type === type)
                if (first) chooseGlobalInstrument(first.name)
              }}>
              <option value="Forex">Forex</option>
              <option value="Commodity">Metals / Energy</option>
              <option value="Crypto">Crypto</option>
              <option value="Index">Indices</option>
              <option value="Stock">Stocks / CFDs</option>
            </select>
          </label>
          <input className="control-input global-search" value={globalSearch}
            onChange={event => setGlobalSearch(event.target.value)} placeholder="Search symbols" />
          <label className="toolbar-group">
            <span className="toolbar-caption">PROVIDER SYMBOL</span>
            <select className="control-select global-symbol-select" value={globalSymbol}
              onChange={event => chooseGlobalInstrument(event.target.value)}>
              {visibleGlobalInstruments.map(item => <option key={item.name} value={item.name}>{item.name} · {item.description}</option>)}
              {!visibleGlobalInstruments.length && <option value="">No matching symbols</option>}
            </select>
          </label>
        </>}
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
              : market === 'GLOBAL'
                ? <button className="selected">Provider market</button>
                : market === 'STOCK'
                  ? <button className="selected">Cash</button>
                  : market === 'COMMODITY'
                    ? <button className="selected">Front-month futures</button>
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
              onChange={(event) => {
                setFeed(undefined)
                setStrike(Number(event.target.value))
              }}>
              {strikes.length ? strikes.map((value) => <option key={value} value={value}>{fmtInt(value)}</option>)
                : <option value={strike}>{fmtInt(strike)}</option>}
            </select>
          </label>
          <label className="toolbar-group">
            <span className="toolbar-caption">EXPIRY</span>
            <select className="control-select expiry-select" value={expiry}
              onChange={(event) => {
                setFeed(undefined)
                setExpiry(event.target.value)
              }}>
              {expiryChoices.map((value) => (
                <option key={value} value={value}>{value === 'UNKNOWN' ? 'Legacy / unknown' : value}</option>
              ))}
            </select>
          </label>
        </>}
        <span className="toolbar-spacer" />
        <label className="toolbar-group">
          <span className="toolbar-caption">{market === 'BTC' || market === 'GLOBAL' ? 'DATE (UTC)' : 'SESSION (IST)'}</span>
          <input className="control-input" type="date" value={date} max={today} onChange={(event) => {
            setFeed(undefined)
            setLiveMetrics(undefined)
            setRealtimeStatus({ state: 'disconnected' })
            setDate(event.target.value)
          }} />
        </label>
        <button className="today-button" disabled={date === today} onClick={() => {
          setFeed(undefined)
          setLiveMetrics(undefined)
          setDate(today)
        }}>Today</button>
        <div className="workspace-controls">
          <label className="toolbar-group grid-layout-control">
            <span className="toolbar-caption">CHARTS</span>
            <select className="control-select grid-layout-select" value={gridPreset}
              onChange={(event) => {
                const preset = event.target.value as ChartGridLayoutId
                try {
                  gridRef.current?.setPreset(preset)
                  setGridPreset(preset)
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : 'Unable to change chart layout')
                }
              }}>
              <option value="1x1">1 Chart</option>
              <option value="1x2">2 Side by side</option>
              <option value="2x1">2 Stacked</option>
              <option value="2x2">4 Charts</option>
              <option value="2x3">6 Charts</option>
              <option value="3x2">6 Wide</option>
            </select>
          </label>
          <input className="control-input workspace-name" value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name" />
          <button className="today-button" onClick={saveWorkspace} disabled={!workspaceName.trim()}>Save</button>
          <select className="control-select workspace-select" value={activeWorkspace}
            onChange={(event) => setActiveWorkspace(event.target.value)}>
            <option value="">Saved layouts</option>
            {Object.keys(workspaces).sort().map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button className="today-button" onClick={() => loadWorkspace(activeWorkspace)} disabled={!activeWorkspace}>Load</button>
        </div>
      </section>

      <section className="status-strip">
        <div className={'source-indicator ' + tone}><span className="source-dot" /><strong>{feed?.label ?? 'Waiting for chart history'}</strong></div>
        <span className="status-detail">{feed?.detail ?? (market === 'BTC' ? 'Public BTC/USDT spot history and live market data' : 'Connect the local Options Dashboard API to load saved market data')}</span>
        <span className="status-spacer" />
        <span>{market === 'BTC' ? '24/7 SPOT MARKET' : market === 'GLOBAL' ? 'GLOBAL PROVIDER FEED' : market === 'STOCK' ? `${visibleCashInstruments.length} configured cash symbols` : market === 'COMMODITY' ? `${visibleCashInstruments.length} configured MCX futures` : `${dates.length} saved sessions`}</span>
        <span className="status-divider" />
        <span className="status-live">{realtimeStatus.state === 'live' ? 'REALTIME STREAM CONNECTED' : realtimeStatus.state === 'connecting' ? 'CONNECTING LIVE STREAM' : realtimeStatus.state === 'reconnecting' ? 'RECONNECTING LIVE STREAM' : 'HISTORICAL MODE'}</span>
      </section>

      <section className="workspace">
        <div className="chart-heading">
          <div>
            <span className="eyebrow">{market === 'BTC' ? 'BITCOIN SPOT' : market === 'GLOBAL' ? 'GLOBAL INDICATIVE MARKET' : market === 'COMMODITY' ? 'MCX FRONT-MONTH FUTURES' : market === 'STOCK' ? 'INDIAN CASH EQUITY' : mode === 'option' ? 'OPTION PREMIUM' : 'INDEX SPOT'}</span>
            <h1>{market === 'BTC'
              ? 'BTC/USDT'
              : market === 'GLOBAL'
                ? globalSymbol
                : market === 'STOCK' || market === 'COMMODITY'
                  ? selectedCashInstrument
                  : mode === 'option' ? index + ' ' + fmtInt(strike) + ' ' + side : index}
              <small>{market === 'BTC' ? cryptoExchange : market === 'GLOBAL' ? 'BIQUOTE' : market === 'STOCK' || market === 'COMMODITY' ? selectedCashExchange : exchangeFor(index, mode === 'option')}</small>
            </h1>
            <p>{market === 'BTC'
              ? 'Exchange-specific spot OHLCV · 24/7 market · no account credentials'
              : market === 'GLOBAL'
                ? `Biquote ${globalType} indicative mid-price · source is not exchange-licensed or guaranteed tradable data`
                : market === 'COMMODITY'
                  ? 'MCX front-month futures-derived OHLC · not spot commodity prices'
                  : market === 'STOCK'
                    ? 'Tick-built cash equity OHLC from the Options Dashboard streamer'
                    : mode === 'option'
                      ? (expiry === 'UNKNOWN' ? 'Sampled LTP observations · historical expiry unknown' : 'Sampled LTP observations · expiry ' + expiry)
                      : 'Tick-built underlying OHLC · cash volume unavailable'}</p>
          </div>
          <div className="chart-meta">
            <strong>{date}</strong>
            <span>{market === 'BTC' || market === 'GLOBAL' ? 'UTC CANDLE SOURCE' : mode === 'option' ? '≈ 30 SEC SNAPSHOT CADENCE' : 'TICK-BUILT CANDLE SOURCE'}</span>
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
        {market === 'INDEX' && (
          <OptionAnalyticsPanel
            callHistory={callHistory}
            putHistory={putHistory}
            chain={chain}
            selectedStrike={strike}
            selectedSide={side}
            showContractHistory={mode === 'option'}
          />
        )}
        <ChartAlertsPanel symbol={currentSymbol} metrics={latest} />
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
