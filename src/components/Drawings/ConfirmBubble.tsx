import { useEffect, useState } from 'react'
import type { ParsedWall } from '../../types'
import { getWallMemory } from '../../wizard/wallMemory'
import styles from './ConfirmBubble.module.css'

interface Props {
  wall: ParsedWall
  position: { x: number; y: number }
  onConfirm: (wall: ParsedWall) => void
  onAdjust: (wall: ParsedWall) => void
  onCancel: () => void
}

export default function ConfirmBubble({ wall, position, onConfirm, onAdjust, onCancel }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [])

  const mem = getWallMemory()

  return (
    <div
      className={`${styles.bubble} ${visible ? styles.visible : ''}`}
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.bubbleBody}>
        <div className={styles.bubbleHeader}>
          <span className={styles.bubbleTitle}>Use same wall type?</span>
        </div>
        <div className={styles.bubbleInfo}>
          <span>{mem.presetId.replace('-', ' ')}</span>
          <span className={styles.bubbleDot}>·</span>
          <span>{mem.thicknessMm}mm</span>
          <span className={styles.bubbleDot}>·</span>
          <span>{mem.isInternal ? 'Internal' : 'External'}</span>
        </div>
        <div className={styles.bubbleActions}>
          <button className={styles.confirmBtn} onClick={() => onConfirm(wall)}>
            ✓ Yes
          </button>
          <button className={styles.adjustBtn} onClick={() => onAdjust(wall)}>
            ✏️ Change
          </button>
          <button className={styles.cancelBtn} onClick={onCancel}>
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
