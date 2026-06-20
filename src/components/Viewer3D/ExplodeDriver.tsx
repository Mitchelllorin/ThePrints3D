/**
 * ExplodeDriver — publishes the eased explode progress EVERY frame so the
 * explode works at all times, including BEFORE a build.
 *
 * BuildingModel only mounts after a build and owns the driver then (it also
 * positions the model centre that the radial layers fan from). This stand-in
 * covers the pre-build / live-tracing phase so the floor sheets still peel off
 * the joists the moment you drag the Explode slider. The two never run at once.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useConfigStore } from '../../store/useConfigStore'
import { explodeRuntime } from './explodeRuntime'

export default function ExplodeDriver() {
  const explodeAmount = useAppStore((s) => s.explodeAmount)
  const modelStatus = useAppStore((s) => s.model.status)
  const explodeSpeed = useConfigStore((s) => s.explodeSpeed)
  const explodeSpread = useConfigStore((s) => s.explodeSpread)
  const cur = useRef(0)

  useFrame((_, delta) => {
    // Once the model is built/building, BuildingModel's driver takes over.
    if (modelStatus === 'building' || modelStatus === 'ready') return
    cur.current = THREE.MathUtils.damp(cur.current, explodeAmount, Math.max(0.1, explodeSpeed), delta)
    const t = cur.current
    explodeRuntime.eased = t * t * (3 - 2 * t)   // smoothstep
    explodeRuntime.spread = explodeSpread
  })

  return null
}
