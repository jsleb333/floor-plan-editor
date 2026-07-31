import type { PlanDocument } from '@/types/plan'
import { deriveJoints, solveConstraints } from '@/utils/geometry'

/**
 * Rebuilds wall connectivity when a document arrives without it — a v7 plan
 * migrated forward, an imported file, or anything hand-edited. Derived from
 * geometry, so it is a repair rather than a guess, and it runs outside the
 * history: nothing the user did is being undone (`docs/WALL_NETWORK.md` §9).
 *
 * Deliberately NOT called from `readPlanDocument` (`@/schema/planDocumentSchema`),
 * even though every other kind of repair lives there: this one runs the
 * constraint solver, and the read funnel is also what the home page's per-card
 * thumbnail fetch goes through (`getDocument` in `@/stores/plans`). Solving once
 * per card on page load is exactly the cost that must stay off the read path, so
 * the two callers that actually open a document for editing call it explicitly.
 *
 * @param document The document as read, joints possibly empty.
 * @returns The same document when its joints are already present or it has no
 *   walls at all, otherwise a copy with derived joints and solved wall geometry.
 */
export function healJoints(document: PlanDocument): PlanDocument {
  if (document.joints.length > 0 || document.walls.length === 0) return document
  const joints = deriveJoints(document.walls)
  // Derived relations are not enough on their own: a pre-v8 document stored T
  // endpoints on the HOST's spine, half a thickness past where the wall really
  // ends. Solving once makes the stored geometry honest, which is what every
  // parametric address on those walls depends on.
  const solution = solveConstraints(
    document.walls,
    joints,
    document.walls.map((wall) => wall.id),
  )
  const walls = document.walls.map((wall) => solution.moved.get(wall.id) ?? wall)
  return { ...document, walls, joints }
}
