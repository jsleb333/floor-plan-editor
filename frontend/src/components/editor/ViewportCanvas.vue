<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useViewport } from '@/composables/useViewport'
import type { Rect } from '@/composables/useViewport'
import type { Point, Viewport } from '@/types/plan'

const props = defineProps<{
  initialViewport: Viewport
}>()

const emit = defineEmits<{
  'viewport-change': [viewport: Viewport]
  'cursor-move': [point: Point | null]
  /** Left-button press on the canvas (not a pan gesture), in world coordinates. */
  'canvas-press': [point: Point, modifiers: { shift: boolean; alt: boolean }]
  /** Release of a left-button press previously reported by canvas-press. */
  'canvas-release': [point: Point]
  'canvas-double-click': []
}>()

const MINOR_GRID_IN = 3
const MAJOR_GRID_IN = 12
/** M1 default document extents used by zoom-to-fit: a 30' x 30' region. */
const DEFAULT_EXTENTS: Rect = { x: 0, y: 0, width: 360, height: 360 }
const FIT_PADDING_PX = 48
const WHEEL_ZOOM_SENSITIVITY = 0.0015
const PINCH_ZOOM_SENSITIVITY = 0.01
/** Screen spacing (px) below which a grid layer is fully faded out. */
const GRID_FADE_START_PX = 5
const GRID_FADE_RANGE_PX = 10
const RULER_LABEL_MIN_PX = 56
const RULER_STEPS_FEET = [1, 2, 5, 10, 20, 50, 100, 200, 500]

const containerEl = ref<HTMLElement | null>(null)
const viewport = useViewport(props.initialViewport)
const spaceHeld = ref(false)
const panning = ref(false)
let panPointerId: number | null = null
let pressPointerId: number | null = null
let lastPanPoint: Point | null = null
let resizeObserver: ResizeObserver | null = null

const scale = viewport.scale
const visible = viewport.visibleWorldRect

/** World-unit stroke width that renders as ~1px on screen. */
const hairline = computed(() => 1 / scale.value)

function gridOpacity(spacingIn: number): number {
  const spacingPx = spacingIn * scale.value
  return Math.min(1, Math.max(0, (spacingPx - GRID_FADE_START_PX) / GRID_FADE_RANGE_PX))
}

const minorGridOpacity = computed(() => gridOpacity(MINOR_GRID_IN))
const majorGridOpacity = computed(() => gridOpacity(MAJOR_GRID_IN))

const gridRect = computed<Rect>(() => ({
  x: visible.value.x - MAJOR_GRID_IN,
  y: visible.value.y - MAJOR_GRID_IN,
  width: visible.value.width + 2 * MAJOR_GRID_IN,
  height: visible.value.height + 2 * MAJOR_GRID_IN,
}))

interface RulerTick {
  position: number
  label: string
}

const rulerStepFeet = computed(() => {
  const pixelsPerFoot = 12 * scale.value
  return RULER_STEPS_FEET.find((step) => step * pixelsPerFoot >= RULER_LABEL_MIN_PX) ?? 1000
})

function buildTicks(startIn: number, endIn: number, toScreen: (worldIn: number) => number) {
  const stepIn = rulerStepFeet.value * 12
  const major: RulerTick[] = []
  const minor: number[] = []
  const subStepIn = stepIn / (rulerStepFeet.value >= 5 ? 5 : rulerStepFeet.value * 2)
  const showSubTicks = subStepIn * scale.value >= 7
  const first = Math.floor(startIn / stepIn) * stepIn
  for (let world = first; world <= endIn + stepIn; world += stepIn) {
    major.push({ position: toScreen(world), label: `${Math.round(world / 12)}'` })
    if (showSubTicks) {
      for (let sub = world + subStepIn; sub < world + stepIn; sub += subStepIn) {
        minor.push(toScreen(sub))
      }
    }
  }
  return { major, minor }
}

const ticksX = computed(() =>
  buildTicks(
    visible.value.x,
    visible.value.x + visible.value.width,
    (world) => viewport.worldToScreen({ x: world, y: 0 }).x,
  ),
)

const ticksY = computed(() =>
  buildTicks(
    visible.value.y,
    visible.value.y + visible.value.height,
    (world) => viewport.worldToScreen({ x: 0, y: world }).y,
  ),
)

const cursorClass = computed(() => {
  if (panning.value) return 'cursor-grabbing'
  if (spaceHeld.value) return 'cursor-grab'
  return 'cursor-default'
})

function screenPointFromEvent(event: PointerEvent | WheelEvent): Point {
  const el = containerEl.value
  if (!el) return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onPointerDown(event: PointerEvent): void {
  const isPanGesture = event.button === 1 || (event.button === 0 && spaceHeld.value)
  if (!isPanGesture) {
    if (event.button === 0 && !panning.value) {
      pressPointerId = event.pointerId
      // Capture so drags keep receiving moves when the pointer leaves the canvas.
      if (event.currentTarget instanceof Element) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      emit('canvas-press', viewport.screenToWorld(screenPointFromEvent(event)), {
        shift: event.shiftKey,
        alt: event.altKey,
      })
    }
    return
  }
  panning.value = true
  panPointerId = event.pointerId
  lastPanPoint = { x: event.clientX, y: event.clientY }
  if (event.currentTarget instanceof Element) {
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (panning.value && event.pointerId === panPointerId && lastPanPoint) {
    viewport.panByScreen(event.clientX - lastPanPoint.x, event.clientY - lastPanPoint.y)
    lastPanPoint = { x: event.clientX, y: event.clientY }
  }
  emit('cursor-move', viewport.screenToWorld(screenPointFromEvent(event)))
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId === pressPointerId) {
    pressPointerId = null
    emit('canvas-release', viewport.screenToWorld(screenPointFromEvent(event)))
    return
  }
  if (event.pointerId !== panPointerId) return
  panning.value = false
  panPointerId = null
  lastPanPoint = null
}

function onPointerLeave(): void {
  emit('cursor-move', null)
}

function onWheel(event: WheelEvent): void {
  // Plain wheel zooms to cursor; ctrl+wheel is the trackpad pinch gesture and
  // zooms too (preventDefault keeps the browser from page-zooming).
  const sensitivity = event.ctrlKey ? PINCH_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY
  viewport.zoomAtPoint(Math.exp(-event.deltaY * sensitivity), screenPointFromEvent(event))
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.code !== 'Space') return
  if (event.target instanceof HTMLElement) {
    const tag = event.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || event.target.isContentEditable)
      return
  }
  spaceHeld.value = true
  event.preventDefault()
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.code === 'Space') spaceHeld.value = false
}

let lastEmitted: Viewport | null = null

watch([viewport.center, viewport.zoom], () => {
  const current = viewport.getViewport()
  if (
    lastEmitted &&
    lastEmitted.center.x === current.center.x &&
    lastEmitted.center.y === current.center.y &&
    lastEmitted.zoom === current.zoom
  ) {
    return
  }
  lastEmitted = current
  emit('viewport-change', current)
})

function zoomToFit(): void {
  viewport.fitToRect(DEFAULT_EXTENTS, FIT_PADDING_PX)
}

function zoomTo100(): void {
  viewport.setZoom(1)
}

defineExpose({ zoomToFit, zoomTo100 })

onMounted(() => {
  const el = containerEl.value
  if (el) {
    const applySize = () => {
      viewport.viewportSize.value = { width: el.clientWidth, height: el.clientHeight }
    }
    applySize()
    lastEmitted = viewport.getViewport()
    resizeObserver = new ResizeObserver(applySize)
    resizeObserver.observe(el)
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<template>
  <section
    ref="containerEl"
    aria-label="Plan viewport"
    class="bg-canvas relative h-full w-full overflow-hidden"
  >
    <svg
      role="img"
      aria-label="Floor plan drawing area"
      class="block h-full w-full touch-none select-none"
      :class="cursorClass"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @dblclick="emit('canvas-double-click')"
      @wheel.prevent="onWheel"
    >
      <defs>
        <pattern
          id="grid-minor"
          :width="MINOR_GRID_IN"
          :height="MINOR_GRID_IN"
          patternUnits="userSpaceOnUse"
        >
          <path
            :d="`M ${MINOR_GRID_IN} 0 H 0 V ${MINOR_GRID_IN}`"
            fill="none"
            class="stroke-grid-minor"
            :stroke-width="hairline"
          />
        </pattern>
        <pattern
          id="grid-major"
          :width="MAJOR_GRID_IN"
          :height="MAJOR_GRID_IN"
          patternUnits="userSpaceOnUse"
        >
          <path
            :d="`M ${MAJOR_GRID_IN} 0 H 0 V ${MAJOR_GRID_IN}`"
            fill="none"
            class="stroke-grid-major"
            :stroke-width="hairline"
          />
        </pattern>
      </defs>
      <g :transform="viewport.transform.value">
        <!-- Underlay image renders below the grid so grid lines stay legible over it. -->
        <slot name="underlay" :hairline="hairline" />
        <rect
          v-if="minorGridOpacity > 0"
          :x="gridRect.x"
          :y="gridRect.y"
          :width="gridRect.width"
          :height="gridRect.height"
          fill="url(#grid-minor)"
          :opacity="minorGridOpacity"
        />
        <rect
          v-if="majorGridOpacity > 0"
          :x="gridRect.x"
          :y="gridRect.y"
          :width="gridRect.width"
          :height="gridRect.height"
          fill="url(#grid-major)"
          :opacity="majorGridOpacity"
        />
        <line
          class="stroke-grid-axis"
          :x1="gridRect.x"
          :x2="gridRect.x + gridRect.width"
          y1="0"
          y2="0"
          :stroke-width="1.5 * hairline"
        />
        <line
          class="stroke-grid-axis"
          x1="0"
          x2="0"
          :y1="gridRect.y"
          :y2="gridRect.y + gridRect.height"
          :stroke-width="1.5 * hairline"
        />
        <slot :hairline="hairline" />
      </g>
    </svg>

    <svg aria-hidden="true" class="bg-surface/90 pointer-events-none absolute inset-x-0 top-0 h-6">
      <g v-for="tick in ticksX.major" :key="`x-${tick.position}`">
        <line
          :x1="tick.position"
          :x2="tick.position"
          y1="14"
          y2="24"
          class="stroke-ink-faint"
          stroke-width="1"
        />
        <text :x="tick.position + 3" y="11" class="fill-ink-muted select-none text-[10px]">
          {{ tick.label }}
        </text>
      </g>
      <line
        v-for="position in ticksX.minor"
        :key="`xm-${position}`"
        :x1="position"
        :x2="position"
        y1="19"
        y2="24"
        class="stroke-line"
        stroke-width="1"
      />
      <line x1="0" x2="100%" y1="23.5" y2="23.5" class="stroke-line" stroke-width="1" />
    </svg>

    <svg aria-hidden="true" class="bg-surface/90 pointer-events-none absolute inset-y-0 left-0 w-6">
      <g v-for="tick in ticksY.major" :key="`y-${tick.position}`">
        <line
          x1="14"
          x2="24"
          :y1="tick.position"
          :y2="tick.position"
          class="stroke-ink-faint"
          stroke-width="1"
        />
        <text
          x="11"
          :y="tick.position - 3"
          class="fill-ink-muted select-none text-[10px]"
          text-anchor="middle"
          :transform="`rotate(-90 11 ${tick.position - 3})`"
        >
          {{ tick.label }}
        </text>
      </g>
      <line
        v-for="position in ticksY.minor"
        :key="`ym-${position}`"
        x1="19"
        x2="24"
        :y1="position"
        :y2="position"
        class="stroke-line"
        stroke-width="1"
      />
      <line x1="23.5" x2="23.5" y1="0" y2="100%" class="stroke-line" stroke-width="1" />
    </svg>

    <div
      aria-hidden="true"
      class="border-line bg-surface absolute top-0 left-0 h-6 w-6 border-r border-b"
    />
  </section>
</template>
