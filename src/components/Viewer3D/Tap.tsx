import { useCallback, useEffect, useRef, type ButtonHTMLAttributes } from 'react'

/**
 * A BUTTON THAT WORKS INSIDE A STOPPED WRAPPER. The 3D overlay wraps its controls in divs that stop clicks
 * natively so they never reach the 3D surface; React hears a click only after
 * it has bubbled up to the root, so a React onClick in here never ran — Undo,
 * Done and tap-to-type all did nothing. This listens on the button itself,
 * which hears the click before the wrapper stops it.
 */
export default function Tap({ onTap, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { onTap: () => void }) {
  const fn = useRef(onTap)
  useEffect(() => { fn.current = onTap })
  const ref = useCallback((el: HTMLButtonElement | null) => {
    if (!el) return
    el.addEventListener('click', () => fn.current())
  }, [])
  return <button type="button" ref={ref} {...rest} />
}
