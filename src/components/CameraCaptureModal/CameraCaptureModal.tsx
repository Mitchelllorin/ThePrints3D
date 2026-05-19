import { useEffect, useRef, useState, useCallback } from 'react'
import styles from './CameraCaptureModal.module.css'

interface Props {
  onImageCaptured: (blob: Blob) => void
  onClose: () => void
}

export default function CameraCaptureModal({ onImageCaptured, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fallbackRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<'opening' | 'live' | 'captured' | 'closing'>('opening')
  const [error, setError] = useState<string | null>(null)
  const capturedBlobRef = useRef<Blob | null>(null)

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  const openCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('no getUserMedia')
      }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: 'environment' } },
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
        })
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setState('live')
    } catch (err) {
      const msg = (err as Error)?.message ?? ''
      if (msg === 'no getUserMedia' || msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Camera access denied or unavailable.')
      }
      triggerFallback()
    }
  }, [])

  useEffect(() => { openCamera(); return stopStream }, [openCamera, stopStream])

  const triggerFallback = useCallback(() => {
    fallbackRef.current?.click()
  }, [])

  const handleCapture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (blob) capturedBlobRef.current = blob
    }, 'image/jpeg', 0.9)
    setState('captured')
  }, [])

  const handleUsePhoto = useCallback(() => {
    const blob = capturedBlobRef.current
    if (blob) {
      stopStream()
      setState('closing')
      setTimeout(() => onImageCaptured(blob), 250)
    }
  }, [stopStream, onImageCaptured])

  const handleRetake = useCallback(() => {
    capturedBlobRef.current = null
    setState('live')
  }, [])

  const handleClose = useCallback(() => {
    stopStream()
    setState('closing')
    setTimeout(() => onClose(), 250)
  }, [stopStream, onClose])

  const handleFallbackChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onImageCaptured(file)
      handleClose()
    }
    e.target.value = ''
  }, [onImageCaptured, handleClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClose()
  }, [handleClose])

  return (
    <div
      className={`${styles.overlay} ${state === 'closing' ? styles.closing : ''}`}
      onClick={handleClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={handleClose} aria-label="Close camera">
          ✕
        </button>

        <div className={styles.viewer}>
          {state === 'opening' && (
            <div className={styles.waiting}>
              <div className={styles.spinner} />
              <p>Opening camera…</p>
            </div>
          )}

          {error && (
            <div className={styles.waiting}>
              <p className={styles.errorText}>{error}</p>
              <p className={styles.errorSub}>Falling back to file picker</p>
            </div>
          )}

          <video
            ref={videoRef}
            className={`${styles.video} ${state === 'live' ? styles.visible : ''}`}
            autoPlay
            playsInline
            muted
          />

          <canvas
            ref={canvasRef}
            className={`${styles.canvas} ${state === 'captured' ? styles.visible : ''}`}
          />
        </div>

        <div className={styles.controls}>
          {state === 'live' && (
            <button className={styles.captureBtn} onClick={handleCapture}>
              📷 Capture
            </button>
          )}
          {state === 'captured' && (
            <>
              <button className={styles.retakeBtn} onClick={handleRetake}>
                🔄 Retake
              </button>
              <button className={styles.useBtn} onClick={handleUsePhoto}>
                ✓ Use Photo
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={fallbackRef}
        type="file"
        accept="image/*"
        onChange={handleFallbackChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}
