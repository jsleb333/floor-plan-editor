import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Session-level layer visibility (spec §6: Layers tab).
 *
 * Structure covers walls, openings and stairs; devices cover electrical
 * pictograms; annotations cover labels and dimension lines. Per-circuit wire
 * visibility (spec C6) is tracked as the SET OF HIDDEN circuit ids, so circuits
 * default to visible and newly created ones need no registration. The
 * underlay's own visibility/lock live in the document
 * (`Underlay.visible`/`locked`); these UI flags are not persisted —
 * document-level layer states arrive with export in M6.
 */
export const useLayersStore = defineStore('layers', () => {
  const structureVisible = ref(true)
  const devicesVisible = ref(true)
  const annotationsVisible = ref(true)
  const hiddenCircuitIds = ref<Set<string>>(new Set())

  /** Whether a circuit's wires are shown on the canvas (spec C6). */
  function isCircuitWiresVisible(circuitId: string): boolean {
    return !hiddenCircuitIds.value.has(circuitId)
  }

  /** Shows or hides a circuit's wires (spec C6). */
  function setCircuitWiresVisible(circuitId: string, visible: boolean): void {
    const next = new Set(hiddenCircuitIds.value)
    if (visible) next.delete(circuitId)
    else next.add(circuitId)
    hiddenCircuitIds.value = next
  }

  /** Toggles a circuit's wire visibility (spec C6). */
  function toggleCircuitWires(circuitId: string): void {
    setCircuitWiresVisible(circuitId, hiddenCircuitIds.value.has(circuitId))
  }

  return {
    structureVisible,
    devicesVisible,
    annotationsVisible,
    hiddenCircuitIds,
    isCircuitWiresVisible,
    setCircuitWiresVisible,
    toggleCircuitWires,
  }
})
