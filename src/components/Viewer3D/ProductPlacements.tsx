import { useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'

const CATEGORY_COLORS: Record<string, string> = {
  doors: '#f97316',
  windows: '#38bdf8',
  'plumbing-fixtures': '#14b8a6',
  'hvac-equipment': '#a78bfa',
  'kitchen-bath': '#eab308',
  flooring: '#84cc16',
  lighting: '#facc15',
}

export default function ProductPlacements() {
  const placements = useAppStore((s) => s.productPlacements)
  const productCatalog = useAppStore((s) => s.productCatalog)

  const items = useMemo(() => {
    return placements
      .map((placement) => {
        const product = productCatalog.find((p) => p.id === placement.productId)
        if (!product) return null
        return { placement, product }
      })
      .filter(Boolean) as Array<{
      placement: typeof placements[number]
      product: typeof productCatalog[number]
    }>
  }, [placements, productCatalog])

  return (
    <group>
      {items.map(({ placement, product }) => (
        <mesh key={placement.id} position={placement.position} rotation={[0, placement.rotationY, 0]} userData={{ layer: 'products', productId: product.id }}>
          <boxGeometry args={[0.6, 0.6, 0.6]} />
          <meshStandardMaterial color={CATEGORY_COLORS[product.category] ?? '#94a3b8'} emissive={CATEGORY_COLORS[product.category] ?? '#475569'} emissiveIntensity={0.15} />
        </mesh>
      ))}
    </group>
  )
}
