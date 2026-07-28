import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { Ref } from 'vue'

import { MODES, TOOLS } from '@/components/editor/tools'
import type { ModeId, ToolId } from '@/components/editor/tools'
import { useToolShortcuts } from '@/composables/useToolShortcuts'
import type { ToolShortcutOptions } from '@/composables/useToolShortcuts'

interface Host {
  wrapper: VueWrapper
  /** Tool ids selected so far, in order. */
  tools: ToolId[]
  /** Mode ids selected so far, in order. */
  modes: ModeId[]
}

/** Mounts a component binding the shortcuts and records what they select. */
function mountShortcuts(options: Omit<ToolShortcutOptions, 'onSelectMode'> = {}): Host {
  const tools: ToolId[] = []
  const modes: ModeId[] = []
  const component = defineComponent({
    setup() {
      useToolShortcuts(TOOLS, (id) => tools.push(id), {
        ...options,
        onSelectMode: options.modes ? (id) => modes.push(id) : undefined,
      })
      return () => h('div')
    },
  })
  return { wrapper: mount(component), tools, modes }
}

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))
}

describe('useToolShortcuts', () => {
  let host: Host | null = null

  afterEach(() => {
    host?.wrapper.unmount()
    host = null
  })

  it('arms the tool the letter names in the active mode (spec E10)', () => {
    const activeMode: Ref<ModeId> = ref('structure')
    host = mountShortcuts({ modes: MODES, activeMode })

    press('d')
    press('w')
    press('c')

    expect(host.tools).toEqual(['door', 'wall', 'calibrate'])
    expect(host.modes).toEqual([])
  })

  it('gives the same letter a different tool in another mode', () => {
    const activeMode: Ref<ModeId> = ref('structure')
    host = mountShortcuts({ modes: MODES, activeMode })

    press('d')
    activeMode.value = 'electrical'
    press('d')
    press('w')

    expect(host.tools).toEqual(['door', 'device', 'wire'])
  })

  it('ignores tool letters that belong to other modes only', () => {
    const activeMode: Ref<ModeId> = ref('electrical')
    host = mountShortcuts({ modes: MODES, activeMode })

    press('n')
    press('c')

    expect(host.tools).toEqual([])
  })

  it('switches mode when the letter names no tool of the active mode', () => {
    const activeMode: Ref<ModeId> = ref('structure')
    host = mountShortcuts({ modes: MODES, activeMode })

    press('e')
    press('i')

    expect(host.modes).toEqual(['electrical', 'inspector'])
    expect(host.tools).toEqual([])
  })

  it('resolves tool letters before mode letters: S is Stairs inside Structure', () => {
    const activeMode: Ref<ModeId> = ref('structure')
    host = mountShortcuts({ modes: MODES, activeMode })

    press('s')

    expect(host.tools).toEqual(['stairs'])
    expect(host.modes).toEqual([])
  })

  it('leaves disabled tools unselectable', () => {
    const activeMode: Ref<ModeId> = ref('inspector')
    host = mountShortcuts({ modes: MODES, activeMode })

    press('m')

    expect(host.tools).toEqual([])
    expect(host.modes).toEqual([])
  })

  it('matches tools across every mode when no active mode is given (legacy callers)', () => {
    host = mountShortcuts()

    press('v')
    press('n')
    press('x')

    expect(host.tools).toEqual(['select', 'window', 'dimension'])
    expect(host.modes).toEqual([])
  })

  it('ignores modified keys, typing targets and suppressed keys', () => {
    const activeMode: Ref<ModeId> = ref('structure')
    host = mountShortcuts({
      modes: MODES,
      activeMode,
      suppress: (event) => event.key === 'c',
    })

    press('w', { ctrlKey: true })
    press('e', { metaKey: true })
    press('c')
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }))
    input.remove()

    expect(host.tools).toEqual([])
    expect(host.modes).toEqual([])
  })

  it('stops listening once the host unmounts', () => {
    const activeMode: Ref<ModeId> = ref('structure')
    const unmounted = mountShortcuts({ modes: MODES, activeMode })
    unmounted.wrapper.unmount()

    press('w')
    press('e')

    expect(unmounted.tools).toEqual([])
    expect(unmounted.modes).toEqual([])
  })
})
