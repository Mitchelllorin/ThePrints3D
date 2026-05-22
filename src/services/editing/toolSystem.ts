export type ToolId = 'select' | 'move' | 'rotate' | 'scale' | 'delete'

export interface ToolDef {
  id: ToolId
  label: string
  icon: string
  shortcut: string
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', icon: '⬆', shortcut: 'V' },
  { id: 'move',   label: 'Move',   icon: '✛', shortcut: 'G' },
  { id: 'rotate', label: 'Rotate', icon: '↻', shortcut: 'R' },
  { id: 'scale',  label: 'Scale',  icon: '⬛', shortcut: 'S' },
  { id: 'delete', label: 'Delete', icon: '✕', shortcut: 'Del' },
]

export const DEFAULT_TOOL: ToolId = 'select'

// ─── State ───────────────────────────────────────────────────────────────────

let _activeTool: ToolId = DEFAULT_TOOL
let _onToolChange: ((tool: ToolId) => void) | null = null
export const KEY_TOOL_MAP: Record<string, ToolId> = {
  v: 'select',
  g: 'move',
  r: 'rotate',
  s: 'scale',
  Delete: 'delete',
}

// ─── API ─────────────────────────────────────────────────────────────────────

export function getActiveTool(): ToolId {
  return _activeTool
}

export function setActiveTool(tool: ToolId): void {
  _activeTool = tool
  _onToolChange?.(tool)
}

export function onToolChange(cb: (tool: ToolId) => void): () => void {
  _onToolChange = cb
  return () => { _onToolChange = null }
}

export function handleToolHotkey(key: string): boolean {
  const mapped = KEY_TOOL_MAP[key]
  if (mapped) {
    setActiveTool(mapped)
    return true
  }
  return false
}
