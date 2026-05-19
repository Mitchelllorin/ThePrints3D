import * as THREE from 'three'

export type TradeLayerId = 'framing' | 'drywall' | 'insulation' | 'finishes'

export const tradeLayerGroup = new Map<TradeLayerId, THREE.Group>()

export function getOrCreateTradeGroup(id: TradeLayerId): THREE.Group {
  let g = tradeLayerGroup.get(id)
  if (!g) {
    g = new THREE.Group()
    g.name = `layer-${id}`
    tradeLayerGroup.set(id, g)
  }
  return g
}

export function resetTradeGroups(): void {
  for (const g of tradeLayerGroup.values()) {
    g.clear()
  }
  tradeLayerGroup.clear()
}

export function setTradeGroupVisibility(id: TradeLayerId, visible: boolean): void {
  const g = tradeLayerGroup.get(id)
  if (g) g.visible = visible
}

export function setAllTradeGroupVisibility(map: Map<string, boolean>): void {
  for (const [id, visible] of map) {
    const g = tradeLayerGroup.get(id as TradeLayerId)
    if (g) g.visible = visible
  }
}
