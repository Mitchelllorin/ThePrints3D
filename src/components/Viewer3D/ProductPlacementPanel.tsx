import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { ProductCatalogItem, ProductCategory } from '../../types/products'
import styles from './ProductPlacementPanel.module.css'

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  doors: 'Doors',
  windows: 'Windows',
  'plumbing-fixtures': 'Plumbing Fixtures',
  'hvac-equipment': 'HVAC Equipment',
  'kitchen-bath': 'Kitchen & Bath',
  flooring: 'Flooring',
  lighting: 'Lighting',
}

export default function ProductPlacementPanel() {
  const productCatalog = useAppStore((s) => s.productCatalog)
  const productPlacements = useAppStore((s) => s.productPlacements)
  const setProductCatalog = useAppStore((s) => s.setProductCatalog)
  const addProductPlacement = useAppStore((s) => s.addProductPlacement)
  const removeProductPlacement = useAppStore((s) => s.removeProductPlacement)
  const clearProductPlacements = useAppStore((s) => s.clearProductPlacements)

  const [category, setCategory] = useState<ProductCategory | 'all'>('all')
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (productCatalog.length > 0) return

    const loadCatalog = async () => {
      try {
        const response = await fetch('/products/catalog.json')
        if (!response.ok) throw new Error(`Failed to load catalog (${response.status})`)
        const data = await response.json() as ProductCatalogItem[]
        if (!cancelled) {
          setProductCatalog(data)
          if (data.length > 0) setSelectedProductId(data[0].id)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load catalog')
      }
    }

    void loadCatalog()
    return () => {
      cancelled = true
    }
  }, [productCatalog.length, setProductCatalog])

  useEffect(() => {
    if (productCatalog.length > 0 && !selectedProductId) {
      setSelectedProductId(productCatalog[0].id)
    }
  }, [productCatalog, selectedProductId])

  const filteredProducts = useMemo(() => {
    return category === 'all' ? productCatalog : productCatalog.filter((p) => p.category === category)
  }, [category, productCatalog])

  const selected = filteredProducts.find((p) => p.id === selectedProductId) ?? filteredProducts[0] ?? null

  const placementsWithProduct = useMemo(() => {
    return productPlacements
      .map((placement) => {
        const product = productCatalog.find((p) => p.id === placement.productId)
        return product ? { placement, product } : null
      })
      .filter(Boolean) as Array<{ placement: typeof productPlacements[number]; product: ProductCatalogItem }>
  }, [productPlacements, productCatalog])

  const placeSelected = () => {
    if (!selected) return
    const offset = productPlacements.length
    addProductPlacement({
      productId: selected.id,
      position: [((offset % 5) - 2) * 1.2, 0.3, Math.floor(offset / 5) * 1.2 - 2],
      rotationY: 0,
    })
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <h3>Product Catalogue</h3>
        {productPlacements.length > 0 && (
          <button className={styles.btn} onClick={clearProductPlacements}>Clear</button>
        )}
      </div>

      <div className={styles.field}>
        <label>Category</label>
        <select
          className={styles.select}
          value={category}
          onChange={(e) => {
            const next = e.target.value as ProductCategory | 'all'
            setCategory(next)
            setSelectedProductId('')
          }}
        >
          <option value="all">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label>Product</label>
        <select
          className={styles.select}
          value={selected?.id ?? ''}
          onChange={(e) => setSelectedProductId(e.target.value)}
          disabled={filteredProducts.length === 0}
        >
          {filteredProducts.map((item) => (
            <option key={item.id} value={item.id}>{item.name} · {item.manufacturer}</option>
          ))}
        </select>
      </div>

      <button className={styles.btn} onClick={placeSelected} disabled={!selected}>➕ Place in model</button>
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.list}>
        {placementsWithProduct.map(({ placement, product }) => (
          <article key={placement.id} className={styles.item}>
            <div className={styles.itemName}>{product.name}</div>
            <div className={styles.meta}>{product.manufacturer} · {CATEGORY_LABELS[product.category]}</div>
            <div className={styles.meta}>Pos: {placement.position.map((v) => v.toFixed(2)).join(', ')}</div>
            <div className={styles.links}>
              <a className={styles.link} href={product.affiliateUrl} target="_blank" rel="noreferrer">Where to buy</a>
              <button className={styles.btn} onClick={() => removeProductPlacement(placement.id)}>Remove</button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  )
}
