export type ProductCategory =
  | 'doors'
  | 'windows'
  | 'plumbing-fixtures'
  | 'hvac-equipment'
  | 'kitchen-bath'
  | 'flooring'
  | 'lighting'

export interface ProductCatalogItem {
  id: string
  manufacturer: string
  category: ProductCategory
  name: string
  modelUrl: string
  specs: Record<string, string>
  affiliateUrl: string
}

export interface ProductPlacement {
  id: string
  productId: string
  position: [number, number, number]
  rotationY: number
  placedAt: number
}
