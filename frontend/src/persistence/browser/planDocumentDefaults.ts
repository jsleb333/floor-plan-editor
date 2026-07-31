import type { PlanCreateOptions } from '@/persistence/ports'
import { planDocumentSchema } from '@/schema/planDocumentSchema'
import type { PlanDocument } from '@/types/plan'

/**
 * The document a newly created plan starts with, matching what `PlanService.create_plan`
 * builds server-side (spec P5): empty collections, the current schema version,
 * and the three seedable settings from the home-page creation card.
 *
 * It is produced by parsing the seeded fields through {@link planDocumentSchema}
 * rather than by listing every field, because that schema's `.default()`s are
 * already the mirror of the backend model's defaults. Spelling them out a second
 * time here would be a second definition of "empty plan", free to drift from the
 * first.
 *
 * An underlay is seeded with the DEFAULT transform — origin (0,0), no rotation,
 * scale 1 — exactly as `Underlay(image_ref=...)` does. It is deliberately not
 * `initialUnderlayTransform()` from `@/utils/underlay`: that one centres and
 * fits the image against a live viewport, which a plan being created does not
 * have yet, and the editor applies it when the user calibrates.
 *
 * @param options The creation card's optional seeds; omitted fields take the
 *   document defaults.
 */
export function createDefaultPlanDocument(options: PlanCreateOptions = {}): PlanDocument {
  return planDocumentSchema.parse({
    underlay:
      options.underlay_asset_id === undefined ? null : { image_ref: options.underlay_asset_id },
    thickness_presets_in: options.thickness_presets_in,
    display_precision_in: options.display_precision_in,
  })
}
