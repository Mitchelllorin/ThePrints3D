import { useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { useAppStore } from '../../store/useAppStore'
import styles from './DrawingUploader.module.css'

const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/tiff': ['.tif', '.tiff'],
  'image/webp': ['.webp'],
}

export default function DrawingUploader() {
  const addDrawings = useAppStore((s) => s.addDrawings)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) addDrawings(accepted)
    },
    [addDrawings]
  )

  const onCameraCapture = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) addDrawings(files)
      e.target.value = ''
    },
    [addDrawings]
  )

  const openCameraCapture = useCallback((e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.stopPropagation()
    cameraInputRef.current?.click()
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    multiple: true,
  })

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h1 className={styles.title}>
          <span className={styles.titleBlue}>Blue</span>
          <span>Print3D</span>
        </h1>
        <p className={styles.subtitle}>
          Scan your construction drawings and turn them into an interactive 3D model.
          <br />
          Supports floor plans, RCP, architectural, structural, MEP sets and more.
        </p>
      </div>

      {/* Hidden input — opens the rear camera on mobile, falls back to file picker on desktop. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={false}
        onChange={onCameraCapture}
        style={{ display: 'none' }}
        data-testid="camera-capture-input"
      />

      {/* Primary CTA — phones default to the camera flow. */}
      <button
        type="button"
        onClick={openCameraCapture}
        className={styles.cameraBtn}
        data-testid="scan-with-camera-btn"
      >
        <span className={styles.cameraIcon}>📷</span>
        <span className={styles.cameraLabel}>Scan a print with your camera</span>
        <span className={styles.cameraSub}>Best for on-site work — uses the rear camera on phones</span>
      </button>

      <div className={styles.orDivider}><span>or upload existing files</span></div>

      <div
        {...getRootProps()}
        className={`${styles.dropzone} ${isDragActive ? styles.active : ''}`}
      >
        <input {...getInputProps()} />
        <div className={styles.dropIcon}>📄</div>
        <p className={styles.dropTitle}>
          {isDragActive ? 'Drop your drawings here…' : 'Drop drawing files here'}
        </p>
        <p className={styles.dropSub}>
          PDF, PNG, JPG, TIFF — drag in a whole drawing set at once
        </p>
        <div className={styles.uploadBtns}>
          <button className={styles.browseBtn} type="button">
            Browse Files
          </button>
          <button
            className={styles.scanBtn}
            type="button"
            onClick={openCameraCapture}
            title="Use your phone camera to photograph a printed blueprint"
          >
            📷 Scan Print
          </button>
        </div>
      </div>

      <div className={styles.features}>
        {FEATURES.map((f) => (
          <div key={f.title} className={styles.featureCard}>
            <span className={styles.featureIcon}>{f.icon}</span>
            <h3 className={styles.featureTitle}>{f.title}</h3>
            <p className={styles.featureDesc}>{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const FEATURES = [
  {
    icon: '🏗️',
    title: 'Full Drawing Set',
    desc: 'Upload floor plans, RCP, architectural, structural and MEP sheets together.',
  },
  {
    icon: '⬡',
    title: 'Interactive 3D Model',
    desc: 'Fly through your building in a real-time 3D environment generated from the drawings.',
  },
  {
    icon: '📷',
    title: 'Scan from Phone',
    desc: 'Point your phone camera at a printed blueprint and scan it directly into the app.',
  },
  {
    icon: '🔀',
    title: 'Toggle Layers',
    desc: 'Show or hide electrical, plumbing, mechanical, structural and more with one click.',
  },
  {
    icon: '📏',
    title: 'Scaled Measurements',
    desc: 'Measurements are auto-calibrated from the drawing scale so every dimension is accurate.',
  },
]
