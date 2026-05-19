export type TransformMode = 'translate' | 'rotate' | 'scale'

let _mode: TransformMode = 'translate'
let _space: 'world' | 'local' = 'world'
let _enabled = true
let _onModeChange: ((mode: TransformMode) => void) | null = null

export function getTransformMode(): TransformMode {
  return _mode
}

export function setTransformMode(mode: TransformMode): void {
  _mode = mode
  _onModeChange?.(mode)
}

export function getTransformSpace(): 'world' | 'local' {
  return _space
}

export function setTransformSpace(space: 'world' | 'local'): void {
  _space = space
}

export function isTransformEnabled(): boolean {
  return _enabled
}

export function setTransformEnabled(enabled: boolean): void {
  _enabled = enabled
}

export function onTransformModeChange(cb: (mode: TransformMode) => void): () => void {
  _onModeChange = cb
  return () => { _onModeChange = null }
}
