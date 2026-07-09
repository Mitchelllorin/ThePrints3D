/**
 * LogoMark — a small, crisp 2D replica of the brand wordmark, pinned top-left in
 * line with the top-right icon row (TopIcons: top:10). The big Logo3DBadge floats
 * as an almost-invisible watermark; this is the always-legible mark.
 *
 * Brand spec: The (blue) · PRINTS (orange, italic) · 3D (green).
 */
export default function LogoMark() {
  return (
    <div
      aria-label="The PRINTS 3D"
      style={{
        position: 'fixed',
        top: 10,
        left: 10,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        zIndex: 100,
        pointerEvents: 'none',
        userSelect: 'none',
        fontWeight: 800,
        fontSize: 17,
        letterSpacing: 0.2,
        lineHeight: 1,
        textShadow: '0 1px 2px rgba(0,0,0,0.45)',
      }}
    >
      <span style={{ color: '#2f80ff' }}>The</span>
      <span style={{ color: '#ffa033', fontStyle: 'italic' }}>PRINTS</span>
      <span style={{ color: '#2fe070' }}>3D</span>
    </div>
  )
}
