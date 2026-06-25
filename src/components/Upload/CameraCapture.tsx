import { useEffect, useRef, useState } from 'react'

/**
 * Live camera capture via getUserMedia — works with a laptop webcam AND phone
 * cameras (secure contexts). The old scan flow used a file input with
 * capture="environment", which only opens the camera on phones; on a laptop it
 * just shows a file picker. This shows a real video preview + a shutter that
 * grabs a frame to a JPEG File.
 *
 * getUserMedia needs a secure context (https or localhost). Over plain LAN http
 * on a phone it's blocked, so the error branch offers the file-input fallback
 * (which still opens the rear camera on mobile).
 */
export default function CameraCapture({
  onCapture, onClose, onFallback,
}: {
  onCapture: (file: File) => void
  onClose: () => void
  onFallback: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
          setReady(true)
        }
      } catch {
        if (!cancelled) setError('Camera not available here — it needs HTTPS or a connected webcam.')
      }
    }
    void start()
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  const snap = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  return (
    <div style={OVERLAY}>
      {error ? (
        <div style={CARD}>
          <p style={{ margin: 0, color: '#e5e7eb' }}>{error}</p>
          <div style={ROW}>
            <button style={PRIMARY} onClick={onFallback}>Pick / snap a photo</button>
            <button style={SECONDARY} onClick={onClose}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted style={VIDEO} />
          <div style={ROW}>
            <button style={PRIMARY} onClick={snap} disabled={!ready}>📷 Capture</button>
            <button style={SECONDARY} onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,0.92)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 16,
}
const VIDEO: React.CSSProperties = { maxWidth: '100%', maxHeight: '78vh', borderRadius: 12, background: '#000' }
const CARD: React.CSSProperties = {
  background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20,
  display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 360, textAlign: 'center',
}
const ROW: React.CSSProperties = { display: 'flex', gap: 10, justifyContent: 'center' }
const PRIMARY: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer',
}
const SECONDARY: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 10, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', cursor: 'pointer',
}
