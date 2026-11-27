import { useEffect, useState } from 'react'
import {
  type Drawing,
  type DrawingController,
  type MagnetMode,
} from 'openalgo-charts/draw'

const TOOL_GROUPS = [
  {
    title: 'Lines',
    tools: [
      ['trend-line', 'Trend line'],
      ['ray', 'Ray'],
      ['extended-line', 'Extended line'],
      ['horizontal-line', 'Horizontal line'],
      ['horizontal-ray', 'Horizontal ray'],
      ['vertical-line', 'Vertical line'],
      ['cross-line', 'Cross line'],
    ],
  },
  {
    title: 'Shapes',
    tools: [
      ['rectangle', 'Rectangle'],
      ['ellipse', 'Ellipse'],
      ['parallel-channel', 'Parallel channel'],
      ['triangle', 'Triangle'],
      ['arrow', 'Arrow'],
      ['fibonacci-retracement', 'Fibonacci retracement'],
      ['fibonacci-extension', 'Fibonacci extension'],
    ],
  },
  {
    title: 'Annotations',
    tools: [
      ['text', 'Text'],
      ['note', 'Note'],
      ['price-label', 'Price label'],
      ['callout', 'Callout'],
      ['price-range', 'Price range'],
      ['date-range', 'Date range'],
      ['long-position', 'Long position'],
      ['short-position', 'Short position'],
    ],
  },
] as const

const DEFAULT_FAVORITES = ['trend-line', 'horizontal-line', 'rectangle', 'fibonacci-retracement', 'long-position']
const FAVORITES_KEY = 'tradethesis-drawing-favorites-v1'

function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    const values = raw ? JSON.parse(raw) as unknown : DEFAULT_FAVORITES
    return Array.isArray(values) ? values.filter((item): item is string => typeof item === 'string') : DEFAULT_FAVORITES
  } catch {
    return [...DEFAULT_FAVORITES]
  }
}

const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  TOOL_GROUPS.flatMap(group => group.tools.map(([id, label]) => [id, label] as [string, string])),
)

function titleForTool(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replaceAll('-', ' ')
}

export function DrawingManagerPanel({
  draw,
  revision,
}: {
  draw?: DrawingController
  revision: number
}) {
  const [favorites, setFavorites] = useState<string[]>(readFavorites)
  const [groupName, setGroupName] = useState('Trade idea')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showAllTools, setShowAllTools] = useState(false)
  const [magnet, setMagnet] = useState<MagnetMode>('weak')

  useEffect(() => {
    try { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)) } catch { /* current-session only */ }
  }, [favorites])

  useEffect(() => {
    if (!draw) return
    setMagnet(draw.magnetMode())
    setSelectedIds([...draw.selection()])
  }, [draw, revision])

  function armTool(tool: string) {
    if (!draw) return
    try {
      draw.setEraser(false)
      draw.setTool(tool)
    } catch {
      // A tool not registered in the installed drawing tier is not armed.
    }
  }

  function toggleFavorite(tool: string) {
    setFavorites(previous => previous.includes(tool)
      ? previous.filter(item => item !== tool)
      : [...previous, tool])
  }

  function setVisibility(item: Drawing) {
    if (!draw || item.policy?.editable === false) return
    draw.update(item.id, { visible: item.visible === false })
  }

  function setLock(item: Drawing) {
    if (!draw || item.policy?.editable === false) return
    draw.update(item.id, { locked: !item.locked })
  }

  function toggleSelected(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(item => item !== id)
      : [...selectedIds, id]
    setSelectedIds(next)
    draw?.select(next)
  }

  function groupSelected() {
    if (!draw || !selectedIds.length || !groupName.trim()) return
    draw.createGroup(groupName, selectedIds)
    setSelectedIds([])
    draw.select(null)
  }

  const allDrawings = draw?.drawings() ?? []
  const groups = draw?.groups() ?? []

  return (
    <section className="drawing-manager">
      <div className="drawing-manager-head">
        <div><span className="eyebrow">CHART OBJECTS</span><h2>Drawing manager</h2></div>
        <div className="drawing-history-controls">
          <button type="button" onClick={() => { draw?.undo() }} disabled={!draw?.canUndo()} title="Undo drawing change">Undo</button>
          <button type="button" onClick={() => { draw?.redo() }} disabled={!draw?.canRedo()} title="Redo drawing change">Redo</button>
          <button type="button" onClick={() => draw?.setEraser(true)} disabled={!draw} title="Arm chart eraser">Eraser</button>
          <button type="button" onClick={() => draw?.setTool(null)} disabled={!draw} title="Return to cursor">Cursor</button>
        </div>
      </div>

      <div className="drawing-tool-row">
        <label className="drawing-magnet">
          <span>MAGNET</span>
          <select value={magnet} disabled={!draw} onChange={event => {
            const value = event.target.value as MagnetMode
            draw?.setOptions({ magnet: value })
            setMagnet(value)
          }}>
            <option value="off">Off</option>
            <option value="weak">OHLC</option>
            <option value="strong">Strong snap</option>
          </select>
        </label>
        <div className="drawing-favorites">
          <span>FAVORITES</span>
          {favorites.map(tool => (
            <button key={tool} type="button" disabled={!draw}
              className={draw?.activeTool() === tool ? 'active' : ''}
              onClick={() => armTool(tool)} title={titleForTool(tool)}>
              {titleForTool(tool)}
            </button>
          ))}
        </div>
        <button type="button" className="drawing-more-tools" onClick={() => setShowAllTools(value => !value)}>
          {showAllTools ? 'Hide tools' : 'All tools'}
        </button>
      </div>

      {showAllTools && <div className="drawing-tool-catalog">
        {TOOL_GROUPS.map(group => (
          <div className="drawing-tool-group" key={group.title}>
            <strong>{group.title}</strong>
            <div>{group.tools.map(([id, label]) => (
              <div key={id} className="drawing-tool-choice">
                <button type="button" disabled={!draw}
                  className={draw?.activeTool() === id ? 'active' : ''}
                  onClick={() => armTool(id)}>{label}</button>
                <button type="button" className="favorite-star"
                  aria-label={favorites.includes(id) ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
                  onClick={() => toggleFavorite(id)}>{favorites.includes(id) ? '★' : '☆'}</button>
              </div>
            ))}</div>
          </div>
        ))}
      </div>}

      <div className="drawing-object-head">
        <strong>Objects on active chart</strong>
        <span>{allDrawings.filter(item => item.policy?.listed !== false).length} drawings · {groups.length} groups</span>
      </div>
      {allDrawings.filter(item => item.policy?.listed !== false).length === 0
        ? <p className="drawing-empty">No drawings on this chart. Choose a favorite or open All tools to start annotating.</p>
        : <div className="drawing-object-list">
          {allDrawings.filter(item => item.policy?.listed !== false).map(item => (
            <div className={'drawing-object ' + (selectedIds.includes(item.id) ? 'selected' : '')} key={item.id}>
              <input type="checkbox" checked={selectedIds.includes(item.id)}
                onChange={() => toggleSelected(item.id)} aria-label={`Select ${titleForTool(item.tool)}`} />
              <button type="button" className="drawing-object-name" onClick={() => draw?.select(item.id)}>
                <strong>{item.text?.value || titleForTool(item.tool)}</strong>
                <small>{item.tool} · pane {item.paneIndex + 1}</small>
              </button>
              <button type="button" title={item.visible === false ? 'Show object' : 'Hide object'}
                disabled={item.policy?.editable === false} onClick={() => setVisibility(item)}>
                {item.visible === false ? 'Show' : 'Hide'}
              </button>
              <button type="button" title={item.locked ? 'Unlock object' : 'Lock object'}
                disabled={item.policy?.editable === false} onClick={() => setLock(item)}>
                {item.locked ? 'Unlock' : 'Lock'}
              </button>
              <button type="button" title="Delete object"
                disabled={item.policy?.editable === false} onClick={() => draw?.remove(item.id)}>×</button>
            </div>
          ))}
        </div>}

      <div className="drawing-group-create">
        <input value={groupName} onChange={event => setGroupName(event.target.value)}
          aria-label="Drawing group name" placeholder="Group name" />
        <button type="button" disabled={!draw || selectedIds.length < 1 || !groupName.trim()}
          onClick={groupSelected}>Group selected</button>
        <button type="button" disabled={!draw || selectedIds.length === 0}
          onClick={() => { draw?.removeMany(selectedIds); setSelectedIds([]) }}>Delete selected</button>
      </div>
      {groups.length > 0 && <div className="drawing-groups">
        {groups.map(group => (
          <span key={group.id}>{group.name} <small>{group.members.length}</small></span>
        ))}
      </div>}
    </section>
  )
}
