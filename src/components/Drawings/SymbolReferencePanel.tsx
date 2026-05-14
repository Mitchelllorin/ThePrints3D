import { useState } from 'react'
import glossary from '../../symbols/glossary.json'
import { resolveSymbolAsset } from '../../symbols/assetRegistry'
import type { SymbolCategory } from '../../symbols/types'
import styles from './SymbolReferencePanel.module.css'

/** Human-readable labels for each symbol category tab. */
const CATEGORY_LABELS: Record<SymbolCategory | 'all', string> = {
  all: 'All',
  wall: 'Walls',
  opening: 'Doors & Windows',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  dimension: 'Dimensions',
  annotation: 'Annotations',
  overhead: 'Overhead',
  section_marker: 'Sections',
  material_hatch: 'Materials',
  fixture: 'Fixtures',
}

/**
 * Reference sheets to show at the top of each category tab.
 * These are the symbol-set images that cover that category broadly.
 */
const CATEGORY_REFERENCE_SHEETS: Partial<Record<SymbolCategory | 'all', string[]>> = {
  all: [
    'download (3).webp',
    'OIP (1).webp',
    'symbols5.webp',
    'symbols4.webp',
  ],
  wall: ['OIP (1).webp', 'download (3).webp', 'symbols4.webp'],
  opening: ['OIP (1).webp', 'download (3).webp', 'download (2).webp', 'download (5).webp'],
  electrical: ['symbols3.jpg', 'symbols5.webp'],
  plumbing: ['symbols5.webp', 'download (3).webp'],
  hvac: ['symbols4.webp'],
  dimension: ['download (3).webp', 'symbols4.webp'],
  material_hatch: ['symbols4.webp'],
}

/** Ordered list of tabs to render. */
const TABS: Array<SymbolCategory | 'all'> = [
  'all',
  'wall',
  'opening',
  'electrical',
  'plumbing',
  'hvac',
  'dimension',
  'annotation',
  'overhead',
  'section_marker',
  'material_hatch',
]

interface Props {
  onClose: () => void
}

export default function SymbolReferencePanel({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<SymbolCategory | 'all'>('all')

  const entries = (glossary.entries as Array<{
    id: string
    category: SymbolCategory
    common_names: string[]
    represents: string
    sample_assets?: string[]
  }>).filter((e) => activeTab === 'all' || e.category === activeTab)

  const referenceSheets = (CATEGORY_REFERENCE_SHEETS[activeTab] ?? [])
    .map((filename) => ({ filename, url: resolveSymbolAsset(filename) }))
    .filter((a): a is { filename: string; url: string } => a.url !== undefined)

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Symbol Reference">
        <div className={styles.header}>
          <span className={styles.title}>📐 Symbol Reference</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close symbol reference">
            ✕
          </button>
        </div>

        <div className={styles.tabs} role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {CATEGORY_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {referenceSheets.length > 0 && (
            <section className={styles.sheetsSection}>
              <h3 className={styles.sectionTitle}>Reference Sheets</h3>
              <div className={styles.sheets}>
                {referenceSheets.map(({ filename, url }) => (
                  <a key={filename} href={url} target="_blank" rel="noopener noreferrer" className={styles.sheetLink}>
                    <img src={url} alt={filename} className={styles.sheetImg} />
                    <span className={styles.sheetLabel}>{filename}</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className={styles.entriesSection}>
            <h3 className={styles.sectionTitle}>
              {CATEGORY_LABELS[activeTab]} Symbols ({entries.length})
            </h3>
            <div className={styles.entries}>
              {entries.map((entry) => {
                const assetUrls = (entry.sample_assets ?? [])
                  .map((f) => resolveSymbolAsset(f))
                  .filter((u): u is string => u !== undefined)
                return (
                  <div key={entry.id} className={styles.entry}>
                    <div className={styles.entryHeader}>
                      <span className={styles.entryName}>{entry.common_names[0]}</span>
                      <span className={styles.entryCategory}>{entry.category}</span>
                    </div>
                    <p className={styles.entryDesc}>{entry.represents}</p>
                    {entry.common_names.length > 1 && (
                      <p className={styles.entryAliases}>
                        Also: {entry.common_names.slice(1).join(', ')}
                      </p>
                    )}
                    {assetUrls.length > 0 && (
                      <div className={styles.entryAssets}>
                        {assetUrls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={url}
                              alt={`${entry.common_names[0]} reference`}
                              className={styles.entryAssetImg}
                            />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
