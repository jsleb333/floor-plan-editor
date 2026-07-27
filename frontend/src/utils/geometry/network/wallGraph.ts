import type { Joint, Wall, WallBodyRef, WallEnd, WallEndRef } from '@/types/plan'

/**
 * The incidence structure of the wall network (`docs/WALL_NETWORK.md` §4).
 *
 * Data, not methods: the resolvers and the constraint solver both walk these
 * maps, and tests can assert on them directly.
 */
export interface WallGraph {
  /** Joints touching each wall end, keyed by `endKey`. A flush relation and a corner may share an end. */
  endJoints: ReadonlyMap<string, readonly Joint[]>
  /** Joints hosted by a wall's body (tee hosts, flush body parties), keyed by wall id. */
  hostJoints: ReadonlyMap<string, readonly Joint[]>
  /** Connected wall-id groups — one painted fill each, so no seam can show inside a body. */
  components: readonly (readonly string[])[]
  /** Joints naming a wall the document does not contain; ignored by the resolvers. */
  danglingJointIds: readonly string[]
}

/** Stable key for one wall end. */
export function endKey(wallId: string, end: WallEnd): string {
  return `${wallId}:${end}`
}

/** True when a joint party addresses a wall end rather than a wall body. */
export function isEndRef(ref: WallEndRef | WallBodyRef): ref is WallEndRef {
  return 'end' in ref
}

/** Every wall id a joint references, in party order. */
export function wallIdsOf(joint: Joint): string[] {
  switch (joint.kind) {
    case 'corner':
      return joint.ends.map((end) => end.wall_id)
    case 'tee':
      return [joint.end.wall_id, joint.host.wall_id]
    case 'flush':
      return [joint.a.ref.wall_id, joint.b.ref.wall_id]
  }
}

/**
 * Indexes `joints` by the wall ends and bodies they touch, and groups walls
 * into connected components.
 *
 * Joints referencing an absent wall are reported in `danglingJointIds` and
 * indexed nowhere, so a resolver never has to re-check that its parties exist.
 */
export function buildWallGraph(walls: readonly Wall[], joints: readonly Joint[]): WallGraph {
  const known = new Set(walls.map((wall) => wall.id))
  const endJoints = new Map<string, Joint[]>()
  const hostJoints = new Map<string, Joint[]>()
  const danglingJointIds: string[] = []
  const union = new DisjointSet(walls.map((wall) => wall.id))

  for (const joint of joints) {
    const ids = wallIdsOf(joint)
    if (ids.length === 0 || ids.some((id) => !known.has(id))) {
      danglingJointIds.push(joint.id)
      continue
    }
    for (const id of ids.slice(1)) union.merge(ids[0], id)
    for (const ref of partiesOf(joint)) {
      if (isEndRef(ref)) push(endJoints, endKey(ref.wall_id, ref.end), joint)
      else push(hostJoints, ref.wall_id, joint)
    }
  }

  return {
    endJoints,
    hostJoints,
    components: union.groups(),
    danglingJointIds,
  }
}

/** Every end/body reference a joint makes, in party order. */
function partiesOf(joint: Joint): (WallEndRef | WallBodyRef)[] {
  switch (joint.kind) {
    case 'corner':
      return [...joint.ends]
    case 'tee':
      return [joint.end, joint.host]
    case 'flush':
      return [joint.a.ref, joint.b.ref]
  }
}

function push(map: Map<string, Joint[]>, key: string, joint: Joint): void {
  const existing = map.get(key)
  if (existing) existing.push(joint)
  else map.set(key, [joint])
}

/** Union-find over wall ids, used only to group connected walls. */
class DisjointSet {
  private readonly parent = new Map<string, string>()

  constructor(ids: readonly string[]) {
    for (const id of ids) this.parent.set(id, id)
  }

  merge(a: string, b: string): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent.set(rootA, rootB)
  }

  /** Groups in first-seen order, so the result is deterministic for tests and caching. */
  groups(): string[][] {
    const byRoot = new Map<string, string[]>()
    for (const id of this.parent.keys()) {
      const root = this.find(id)
      const group = byRoot.get(root)
      if (group) group.push(id)
      else byRoot.set(root, [id])
    }
    return [...byRoot.values()]
  }

  private find(id: string): string {
    let current = id
    while (this.parent.get(current) !== current) {
      const next = this.parent.get(current)
      if (next === undefined) return current
      current = next
    }
    return current
  }
}
