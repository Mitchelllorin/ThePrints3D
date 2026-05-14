import type { WallType } from '../types'

export const COMMON_WALL_TYPES: WallType[] = [
  { id: 'EXT', name: 'Exterior', thicknessMm: 250, layers: [], loadBearing: true, usage: 'exterior', markupTag: 'EXT', color: '#94a3b8' },
  { id: 'INT', name: 'Interior', thicknessMm: 120, layers: [], loadBearing: false, usage: 'interior', markupTag: 'INT', color: '#e2e8f0' },
  { id: 'IW', name: 'Interior Wall', thicknessMm: 100, layers: [], loadBearing: false, usage: 'partition', markupTag: 'IW', color: '#cbd5e1' },
  { id: 'PT', name: 'Partition', thicknessMm: 75, layers: [], loadBearing: false, usage: 'partition', markupTag: 'PT', color: '#f1f5f9' },
]

export interface SmartProcessingState {
  processor: 'heuristic' | 'ai' | 'seed-guided'
  userTraces: import('../types').UserTrace[]
  seedMode: boolean
  wallTypes: WallType[]
  projectWallTypes: WallType[]
  stageLabel: string
  correctionCount: number
  detectedWallTypes: import('../types').DetectedWallType[]
}

export const defaultSmartProcessingState: SmartProcessingState = {
  processor: 'heuristic',
  userTraces: [],
  seedMode: false,
  wallTypes: [],
  projectWallTypes: COMMON_WALL_TYPES,
  stageLabel: 'Heuristic Detection',
  correctionCount: 0,
  detectedWallTypes: [],
}
