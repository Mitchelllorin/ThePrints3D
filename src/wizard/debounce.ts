export type DebouncedCallback = () => void

let _timeoutId: ReturnType<typeof setTimeout> | null = null

export function debounce(cb: DebouncedCallback, delayMs = 350): void {
  clearTimeout(_timeoutId!)
  _timeoutId = setTimeout(cb, delayMs)
}

export function cancelDebounce(): void {
  if (_timeoutId !== null) {
    clearTimeout(_timeoutId)
    _timeoutId = null
  }
}
