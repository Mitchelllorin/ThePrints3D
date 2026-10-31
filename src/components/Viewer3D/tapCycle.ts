/**
 * TAP AGAIN TO GO DEEPER — one answer to "what did that tap pick".
 *
 * The slab, the walls, the roof, the joists and the placed objects each listen
 * for taps on their own, and whichever heard it first won. That was often the
 * wrong thing, and the only way to a single stud was a Whole / Member switch
 * you had to know was there.
 *
 * Now every tap asks this module, which lines up EVERYTHING under the finger:
 * front to back, each whole thing before its pieces —
 *
 *     door → wall → stud → floor → joist → (round again)
 *
 * The first tap takes the first of those. Tap the same spot again and it steps
 * to the next one, and past the last it comes back round to the first — so if
 * the pick is wrong, keep tapping and what you meant always comes up.
 *
 * Pressing what is already selected still DRAGS it, exactly as before; only a
 * press that ends where it started (a tap) steps on. So moving a floor and
 * digging under it never fight over the same gesture.
 *
 * How things take part:
 *   userData.pick = { key, select }   on a thing you can select whole —
 *                                     a wall's pick box, a floor, a roof, an object
 *   userData.pickMembers = true       on a group whose meshes are its sticks —
 *                                     framing, joists, rafters; any mesh in it
 *                                     with a userData.id is a member
 * and each layer's pointer-down starts with `if (!tapCycle.mine(e, key)) return`,
 * BEFORE stopPropagation — so a tap that belongs to something further back
 * carries on through to it.
 */
import type { ThreeEvent } from '@react-three/fiber'
import type * as THREE from 'three'
import { useFloorplanLocalStore } from '../../store/useFloorplanLocalStore'

export interface PickTag {
  /** 'wall:…', 'floor:…', 'roof:…', 'object:…' — or 'member:<id>' for a stick. */
  key: string
  /** Select this thing, the same way its own layer would. */
  select: () => void
  /** Meshes inside it carrying a userData.id are its members (joists, rafters). */
  members?: boolean
}

/** A second tap within this many screen pixels of the last is "the same spot". */
const SAME_SPOT_PX = 30
/** A press that travels this far is a drag, not a tap. */
const TAP_SLOP_PX = 8

export const memberKey = (id: string) => `member:${id}`

/** Everything under the pointer, front to back, each whole before its pieces. */
export function candidatesFrom(intersections: readonly { object: THREE.Object3D }[]): PickTag[] {
  const out: PickTag[] = []
  const seen = new Set<string>()
  const push = (t: PickTag) => { if (!seen.has(t.key)) { seen.add(t.key); out.push(t) } }
  for (const hit of intersections) {
    let whole: PickTag | null = null
    let hasMembers = false
    let skip = false
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      if (o.userData?.noPick) { skip = true; break }
      if (!whole && o.userData?.pick) whole = o.userData.pick as PickTag
      if (o.userData?.pickMembers || (o !== hit.object && o.userData?.pick?.members)) hasMembers = true
    }
    if (skip) continue
    if (whole) push(whole)
    const ud = hit.object.userData as { id?: unknown; label?: string; componentType?: string }
    if (hasMembers && typeof ud.id === 'string' && !hit.object.userData?.pick) {
      const id = ud.id
      const label = ud.label ?? ud.componentType ?? 'Member'
      push({ key: memberKey(id), select: () => useFloorplanLocalStore.getState().selectMember(id, label) })
    }
  }
  return out
}

/** The step to take from `currentKey` through `list`: the next one, wrapping. */
export function nextAfter(list: readonly PickTag[], currentKey: string): PickTag | null {
  if (list.length === 0) return null
  const i = list.findIndex((c) => c.key === currentKey)
  return list[(i + 1) % list.length]
}

let last: { key: string; x: number; y: number } | null = null
const decided = new WeakMap<Event, string | null>()

function decide(e: ThreeEvent<PointerEvent>): string | null {
  const ev = e.nativeEvent
  if (decided.has(ev)) return decided.get(ev)!
  const list = candidatesFrom(e.intersections)
  let key: string | null = null
  if (list.length > 0) {
    const sameSpot = last != null && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) <= SAME_SPOT_PX
    const stillSelected = useFloorplanLocalStore.getState().editSelected != null
    if (last && sameSpot && stillSelected && list.some((c) => c.key === last!.key)) {
      // A press on what is already selected: its owner gets the press (so a
      // drag still moves it), and if it ends as a tap, step to the next thing.
      key = last.key
      armStep(ev, list, last.key)
    } else {
      key = list[0].key
      last = { key, x: ev.clientX, y: ev.clientY }
    }
  }
  decided.set(ev, key)
  return key
}

function armStep(down: PointerEvent, list: PickTag[], fromKey: string) {
  if (typeof window === 'undefined') return
  let travelled = 0
  const move = (m: PointerEvent) => {
    if (m.pointerId !== down.pointerId) return
    travelled = Math.max(travelled, Math.hypot(m.clientX - down.clientX, m.clientY - down.clientY))
  }
  const up = (u: PointerEvent) => {
    if (u.pointerId !== down.pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    if (u.type === 'pointercancel' || travelled > TAP_SLOP_PX) return
    const next = nextAfter(list, fromKey)
    if (!next) return
    // After the layers have finished their own release (a pending object move
    // re-selects on release), so the step is the last word.
    setTimeout(() => {
      next.select()
      last = { key: next.key, x: down.clientX, y: down.clientY }
    }, 0)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

export const tapCycle = {
  /** Does this tap belong to `key`? False means: let it carry on to what is behind. */
  mine(e: ThreeEvent<PointerEvent>, key: string): boolean {
    return decide(e) === key
  },
  /** Forget the last pick — a new selection made some other way starts fresh. */
  reset() { last = null },
}
