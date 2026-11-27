import type {
  OptionChainResponse,
  OptionHistoryPoint,
  OptionSide,
} from './api'

type MetricKey = 'oi' | 'oi_change' | 'iv' | 'delta' | 'gamma' | 'theta' | 'vega' | 'gex' | 'ltp'

function number(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function fmt(value: number | undefined, digits = 2): string {
  if (value === undefined) return '—'
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

function fmtInt(value: number | undefined): string {
  if (value === undefined) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
}

function Sparkline({
  title,
  rows,
  field,
  digits = 2,
}: {
  title: string
  rows: OptionHistoryPoint[]
  field: MetricKey
  digits?: number
}) {
  const values = rows.map(row => number(row[field])).filter((value): value is number => value !== undefined)
  const last = values.at(-1)
  if (!values.length) {
    return (
      <div className="analytics-spark">
        <div className="analytics-spark-head"><span>{title}</span><strong>—</strong></div>
        <div className="spark-empty">No saved observations</div>
      </div>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || Math.max(Math.abs(max) * 0.02, 1)
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 210 : 8 + index / (values.length - 1) * 404
    const y = 54 - ((value - min) / range) * 44
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <div className="analytics-spark">
      <div className="analytics-spark-head"><span>{title}</span><strong>{fmt(last, digits)}</strong></div>
      <svg viewBox="0 0 420 64" preserveAspectRatio="none" role="img" aria-label={`${title} historical series`}>
        <line x1="8" y1="55" x2="412" y2="55" className="spark-baseline" />
        <polyline points={points} className="spark-line" />
      </svg>
      <div className="spark-range"><span>{fmt(min, digits)}</span><span>{values.length} samples</span><span>{fmt(max, digits)}</span></div>
    </div>
  )
}

function Level({ label, value, kind }: { label: string; value: number | null | undefined; kind?: string }) {
  return (
    <div className={'chain-level ' + (kind ?? '')}>
      <span>{label}</span>
      <strong>{value === null || value === undefined ? '—' : fmtInt(value)}</strong>
    </div>
  )
}

function OiProfile({ chain, selectedStrike }: { chain: OptionChainResponse; selectedStrike: number }) {
  const rows = chain.strikes.filter(row => (number(row.CE?.oi) ?? 0) + (number(row.PE?.oi) ?? 0) > 0)
  const maximum = Math.max(1, ...rows.flatMap(row => [number(row.CE?.oi) ?? 0, number(row.PE?.oi) ?? 0]))
  const visible = rows.slice().sort((a, b) => Math.abs(a.strike - selectedStrike) - Math.abs(b.strike - selectedStrike)).slice(0, 17).sort((a, b) => a.strike - b.strike)
  if (!visible.length) return <div className="analytics-empty">No open-interest rows in the selected chain snapshot.</div>
  return (
    <div className="oi-profile">
      {visible.map(row => {
        const ce = number(row.CE?.oi) ?? 0
        const pe = number(row.PE?.oi) ?? 0
        return (
          <div className={'oi-profile-row ' + (row.strike === selectedStrike ? 'active' : '')} key={row.strike}>
            <span className="oi-strike">{fmtInt(row.strike)}</span>
            <div className="oi-track ce"><span style={{ width: `${ce / maximum * 100}%` }} /></div>
            <div className="oi-track pe"><span style={{ width: `${pe / maximum * 100}%` }} /></div>
            <span className="oi-total">{fmtInt(ce + pe)}</span>
          </div>
        )
      })}
      <div className="oi-legend"><span className="ce-key">CALL OI</span><span className="pe-key">PUT OI</span><span>Nearest 17 active strikes</span></div>
    </div>
  )
}

function SideSummary({ label, row, side }: {
  label: string
  row?: OptionHistoryPoint
  side: OptionSide
}) {
  return (
    <div className={'side-summary ' + (side === 'CE' ? 'call' : 'put')}>
      <strong>{label}</strong>
      <div><span>Premium</span><b>{fmt(number(row?.ltp))}</b></div>
      <div><span>OI</span><b>{fmtInt(number(row?.oi))}</b></div>
      <div><span>IV</span><b>{fmt(number(row?.iv))}</b></div>
      <div><span>Delta</span><b>{fmt(number(row?.delta), 3)}</b></div>
    </div>
  )
}

export function OptionAnalyticsPanel({
  callHistory,
  putHistory,
  chain,
  selectedStrike,
  selectedSide,
}: {
  callHistory: OptionHistoryPoint[]
  putHistory: OptionHistoryPoint[]
  chain?: OptionChainResponse
  selectedStrike: number
  selectedSide: OptionSide
}) {
  const call = callHistory.at(-1)
  const put = putHistory.at(-1)
  const rows = selectedSide === 'CE' ? callHistory : putHistory
  const analytics = chain?.analytics
  return (
    <section className="advanced-analytics">
      <div className="analytics-title">
        <div><span className="eyebrow">TRADETHESIS OPTIONS INTELLIGENCE</span><h2>Contract analytics</h2></div>
        <span>{chain?.asof ? `CHAIN SNAPSHOT · ${chain.asof}` : 'WAITING FOR CHAIN SNAPSHOT'}</span>
      </div>
      <div className="chain-levels">
        <Level label="CALL OI WALL" value={analytics?.call_wall} kind="call-level" />
        <Level label="PUT OI WALL" value={analytics?.put_wall} kind="put-level" />
        <Level label="MAX PAIN" value={analytics?.max_pain} />
        <Level label="GAMMA FLIP" value={analytics?.gamma_flip} />
        <Level label="MAX GEX STRIKE" value={analytics?.max_gex_strike} />
        <Level label="NET GEX" value={number(analytics?.net_gex)} />
      </div>
      {analytics?.max_pain_source === 'open_interest_estimate' && (
        <p className="analytics-caveat">Max pain is estimated from the saved open-interest chain because the snapshot did not store a max-pain value.</p>
      )}
      <div className="analytics-grid">
        <div className="analytics-panel">
          <div className="analytics-panel-head"><strong>Open-interest profile</strong><span>Selected expiry · {fmtInt(selectedStrike)} ATM selection</span></div>
          {chain ? <OiProfile chain={chain} selectedStrike={selectedStrike} /> : <div className="analytics-empty">Chain profile unavailable for this session.</div>}
        </div>
        <div className="analytics-panel">
          <div className="analytics-panel-head"><strong>CE / PE comparison</strong><span>Latest saved observation</span></div>
          <div className="side-comparison">
            <SideSummary label="CALL" row={call} side="CE" />
            <SideSummary label="PUT" row={put} side="PE" />
          </div>
        </div>
      </div>
      <div className="analytics-panel history-panel">
        <div className="analytics-panel-head"><strong>{selectedSide} historical metrics · {fmtInt(selectedStrike)}</strong><span>Approximately 30-second saved samples</span></div>
        <div className="analytics-spark-grid">
          <Sparkline title="PREMIUM" rows={rows} field="ltp" />
          <Sparkline title="OPEN INTEREST" rows={rows} field="oi" digits={0} />
          <Sparkline title="OI CHANGE" rows={rows} field="oi_change" digits={0} />
          <Sparkline title="IMPLIED VOLATILITY" rows={rows} field="iv" />
          <Sparkline title="DELTA" rows={rows} field="delta" digits={3} />
          <Sparkline title="GAMMA" rows={rows} field="gamma" digits={5} />
          <Sparkline title="THETA" rows={rows} field="theta" digits={3} />
          <Sparkline title="VEGA" rows={rows} field="vega" digits={3} />
          <Sparkline title="GAMMA EXPOSURE" rows={rows} field="gex" digits={0} />
        </div>
      </div>
    </section>
  )
}
