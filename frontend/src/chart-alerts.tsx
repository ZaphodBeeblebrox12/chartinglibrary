import { useEffect, useState } from 'react'
import type { OptionMetrics } from './data'

type AlertMetric = 'ltp' | 'oi' | 'oiChange' | 'iv' | 'delta' | 'gamma' | 'theta' | 'vega'
type AlertOperator = 'above' | 'below'

interface ChartAlertRule {
  id: string
  symbol: string
  metric: AlertMetric
  operator: AlertOperator
  threshold: number
  enabled: boolean
  firedAt?: string
}

const STORAGE_KEY = 'tradethesis-chart-alert-rules-v1'

function readRules(): ChartAlertRule[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as ChartAlertRule[] : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function metricValue(metrics: OptionMetrics | undefined, key: AlertMetric): number | undefined {
  if (!metrics) return undefined
  const value = metrics[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function displayMetric(key: AlertMetric): string {
  return ({
    ltp: 'Premium', oi: 'Open interest', oiChange: 'OI change',
    iv: 'Implied volatility', delta: 'Delta', gamma: 'Gamma',
    theta: 'Theta', vega: 'Vega',
  })[key]
}

export function ChartAlertsPanel({
  symbol,
  metrics,
}: {
  symbol: string
  metrics?: OptionMetrics
}) {
  const [rules, setRules] = useState<ChartAlertRule[]>(readRules)
  const [metric, setMetric] = useState<AlertMetric>('ltp')
  const [operator, setOperator] = useState<AlertOperator>('above')
  const [threshold, setThreshold] = useState('')

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
    } catch {
      // The rules remain available for the current tab session.
    }
  }, [rules])

  useEffect(() => {
    if (!metrics) return
    const now = new Date().toISOString()
    setRules(previous => previous.map(rule => {
      if (!rule.enabled || rule.firedAt || rule.symbol !== symbol) return rule
      const value = metricValue(metrics, rule.metric)
      if (value === undefined) return rule
      const crossed = rule.operator === 'above' ? value >= rule.threshold : value <= rule.threshold
      return crossed ? { ...rule, firedAt: now, enabled: false } : rule
    }))
  }, [metrics, symbol])

  function addRule() {
    const value = Number(threshold)
    if (!Number.isFinite(value) || threshold.trim() === '') return
    setRules(previous => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol,
      metric,
      operator,
      threshold: value,
      enabled: true,
    }, ...previous])
    setThreshold('')
  }

  function rearm(id: string) {
    setRules(previous => previous.map(rule =>
      rule.id === id ? { ...rule, enabled: true, firedAt: undefined } : rule,
    ))
  }

  return (
    <section className="chart-alerts">
      <div className="analytics-title">
        <div><span className="eyebrow">CONDITION MONITORING</span><h2>Chart alerts</h2></div>
        <span>LOCAL WORKSTATION · THIS BROWSER</span>
      </div>
      <div className="alert-create-row">
        <label><span>METRIC</span><select value={metric} onChange={e => setMetric(e.target.value as AlertMetric)}>
          <option value="ltp">Premium</option><option value="oi">Open interest</option>
          <option value="oiChange">OI change</option><option value="iv">Implied volatility</option>
          <option value="delta">Delta</option><option value="gamma">Gamma</option>
          <option value="theta">Theta</option><option value="vega">Vega</option>
        </select></label>
        <label><span>CONDITION</span><select value={operator} onChange={e => setOperator(e.target.value as AlertOperator)}>
          <option value="above">At or above</option><option value="below">At or below</option>
        </select></label>
        <label><span>VALUE</span><input type="number" step="any" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="Threshold" /></label>
        <button type="button" onClick={addRule} disabled={!threshold.trim() || !Number.isFinite(Number(threshold))}>Add alert</button>
      </div>
      <div className="alert-rules">
        {rules.filter(rule => rule.symbol === symbol).length === 0
          ? <p className="analytics-empty">No alerts for this selected contract. Alerts are checked against new live option samples while this workstation is open.</p>
          : rules.filter(rule => rule.symbol === symbol).map(rule => (
            <div className="alert-rule" key={rule.id}>
              <span className="alert-rule-state">{rule.firedAt ? 'TRIGGERED' : rule.enabled ? 'ARMED' : 'PAUSED'}</span>
              <strong>{displayMetric(rule.metric)} {rule.operator === 'above' ? '≥' : '≤'} {rule.threshold}</strong>
              {rule.firedAt && <time>{new Date(rule.firedAt).toLocaleTimeString()}</time>}
              {rule.firedAt && <button type="button" onClick={() => rearm(rule.id)}>Re-arm</button>}
              {!rule.firedAt && <button type="button" onClick={() => setRules(prev => prev.map(item => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))}>{rule.enabled ? 'Pause' : 'Resume'}</button>}
              <button type="button" className="alert-remove" onClick={() => setRules(prev => prev.filter(item => item.id !== rule.id))}>Remove</button>
            </div>
          ))}
      </div>
    </section>
  )
}
