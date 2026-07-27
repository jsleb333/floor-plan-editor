import type { WallBodyRef, WallEndRef } from '@/types/plan'

import { endKey } from './wallGraph'

/**
 * Stable ids for wall relations, derived from the parties they relate
 * (`docs/WALL_NETWORK.md` §3).
 *
 * Derived rather than random so that "the same relation" is the same id no
 * matter who produced it — the wall tool at draw time, a drag, or the
 * coincidence pass rebuilding connectivity. Duplicating a relation then becomes
 * impossible by construction instead of something every caller has to check
 * for, and re-deriving an unchanged document is a no-op.
 */

/** A corner between wall ends; independent of the order they were captured in. */
export function cornerJointId(ends: readonly WallEndRef[]): string {
  return `corner:${ends
    .map((ref) => endKey(ref.wall_id, ref.end))
    .sort()
    .join('|')}`
}

/** A T: the butting end and the host segment it abuts. */
export function teeJointId(end: WallEndRef, host: WallBodyRef): string {
  return `tee:${endKey(end.wall_id, end.end)}>${host.wall_id}#${host.segment_index}`
}

/** A shared surface between two parties; independent of which was captured first. */
export function flushJointId(a: WallEndRef | WallBodyRef, b: WallEndRef | WallBodyRef): string {
  return `flush:${[partyKey(a), partyKey(b)].sort().join('|')}`
}

function partyKey(ref: WallEndRef | WallBodyRef): string {
  return 'end' in ref ? endKey(ref.wall_id, ref.end) : `${ref.wall_id}#${ref.segment_index}`
}
