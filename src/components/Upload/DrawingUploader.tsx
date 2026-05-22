import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useAppStore } from '../../store/useAppStore'
import { SAMPLE_DRAWINGS, renderSvgToPng } from '../../data/sampleDrawings'
import CameraCaptureModal from '../CameraCaptureModal/CameraCaptureModal'
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
  const [loadingSample, setLoadingSample] = useState<string | null>(null)
  const [showCamera, setShowCamera] = useState(false)

  const handleSample = async (sample: typeof SAMPLE_DRAWINGS[0]) => {
    setLoadingSample(sample.id)
    try {
      const svg = sample.generateSvg(sample.width, sample.height)
      const blob = await renderSvgToPng(svg, sample.width, sample.height)
      const file = new File([blob], `${sample.id}.png`, { type: 'image/png' })
      addDrawings([file])
      const store = useAppStore.getState()
      for (const d of store.drawings.filter(d => d.status === 'pending')) store.processDrawing(d.id)
    } catch (err) {
      console.error('Sample failed:', err)
    } finally {
      setLoadingSample(null)
    }
  }

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) addDrawings(accepted)
    },
    [addDrawings]
  )

  const openCameraCapture = useCallback((e?: React.MouseEvent<HTMLButtonElement>) => {
    e?.stopPropagation()
    setShowCamera(true)
  }, [])

  const handleCameraCapture = useCallback((blob: Blob) => {
    const file = new File([blob], `camera-capture-${Date.now()}.jpg`, { type: 'image/jpeg' })
    addDrawings([file])
    setShowCamera(false)
    const store = useAppStore.getState()
    for (const d of store.drawings.filter(d => d.status === 'pending')) store.processDrawing(d.id)
  }, [addDrawings])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    multiple: true,
  })

  const difficultyIcon = (d: string) => {
    switch (d) {
      case 'simple': return '🟢'
      case 'intermediate': return '🟡'
      case 'difficult': return '🔴'
      default: return ''
    }
  }

  const difficultyLabel = (d: string) => {
    switch (d) {
      case 'simple': return 'Simple'
      case 'intermediate': return 'Medium'
      case 'difficult': return 'Hard'
      default: return d
    }
  }

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

      <div className={styles.samplesSection}>
        <div className={styles.orDivider}><span>or try a sample drawing</span></div>
        <div className={styles.sampleRow}>
          {SAMPLE_DRAWINGS.map((s) => {
            const busy = loadingSample === s.id
            return (
              <button key={s.id} className={styles.sampleCard} onClick={() => handleSample(s)} disabled={busy}>
                <div className={styles.sampleBadgeRow}>
                  <span className={styles.sampleBadge}>{difficultyIcon(s.difficulty)} {difficultyLabel(s.difficulty)}</span>
                </div>
                <div className={styles.sampleCardBody}>
                  <div className={styles.sampleName}>{s.name}</div>
                  <div className={styles.sampleDesc}>{s.description}</div>
                  <div className={styles.sampleTags}>
                    {s.tags.map(t => <span key={t} className={styles.sampleTag}>{t}</span>)}
                  </div>
                </div>
                <div className={styles.sampleCTA}>{busy ? 'Loading…' : 'Load →'}</div>
              </button>
            )
          })}
        </div>
      </div>

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

      {showCamera && (
        <CameraCaptureModal
          onImageCaptured={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
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
