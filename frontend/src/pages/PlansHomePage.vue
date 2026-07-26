<script setup lang="ts">
import { ArchiveRestore, Plus, Trash2, Upload } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import PlanCard from '@/components/PlanCard.vue'
import PlanCreateCard from '@/components/PlanCreateCard.vue'
import { importPlanJson } from '@/export/jsonExport'
import { usePlansStore } from '@/stores/plans'
import type { Plan } from '@/types/plan'
import { formatRelativeTime } from '@/utils/relativeTime'

const router = useRouter()
const plansStore = usePlansStore()

const loading = ref(true)
const error = ref<string | null>(null)
const creating = ref(false)
const confirmingDeleteId = ref<string | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

const activePlans = computed(() => plansStore.plans.filter((plan) => !plan.archived_at))
const archivedPlans = computed(() => plansStore.plans.filter((plan) => plan.archived_at))

function messageFrom(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error'
}

async function run(action: () => Promise<unknown>): Promise<void> {
  error.value = null
  try {
    await action()
  } catch (err) {
    error.value = messageFrom(err)
  }
}

function startCreate(): void {
  creating.value = true
}

function cancelCreate(): void {
  creating.value = false
}

/** A plan created with a photo opens straight in Calibrate mode (spec P5/E9). */
async function handleCreated(plan: Plan): Promise<void> {
  creating.value = false
  await router.push({ name: 'editor', params: { planId: plan.id } })
}

function openPlan(id: string): void {
  void router.push({ name: 'editor', params: { planId: id } })
}

function triggerImport(): void {
  importInput.value?.click()
}

async function handleImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value) return
  importing.value = true
  error.value = null
  try {
    const { name, document } = await importPlanJson(file)
    const plan = await plansStore.importPlan(name, document)
    await router.push({ name: 'editor', params: { planId: plan.id } })
  } catch (err) {
    error.value = messageFrom(err)
  } finally {
    importing.value = false
  }
}

function confirmDelete(id: string): void {
  confirmingDeleteId.value = id
}

async function handleDelete(id: string): Promise<void> {
  confirmingDeleteId.value = null
  await run(() => plansStore.remove(id))
}

onMounted(async () => {
  try {
    await plansStore.load()
  } catch (err) {
    error.value = messageFrom(err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="bg-canvas min-h-screen">
    <header class="mx-auto flex max-w-5xl items-center justify-between px-6 pt-10 pb-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Floor plans</h1>
        <p class="text-ink-muted mt-1 text-sm">
          Draw residential plans and their electrical layout.
        </p>
      </div>
      <div v-if="!creating" class="flex items-center gap-2">
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json"
          class="hidden"
          aria-hidden="true"
          @change="handleImportFile"
        />
        <button
          type="button"
          :disabled="importing"
          class="border-line text-ink-muted hover:text-ink hover:border-ink-faint flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          @click="triggerImport"
        >
          <Upload :size="16" aria-hidden="true" />
          {{ importing ? 'Importing…' : 'Import' }}
        </button>
        <button
          type="button"
          class="bg-accent hover:bg-accent-strong flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white transition-colors"
          @click="startCreate"
        >
          <Plus :size="16" aria-hidden="true" />
          New plan
        </button>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-6 pb-16">
      <PlanCreateCard v-if="creating" @created="handleCreated" @cancel="cancelCreate" />

      <p
        v-if="error"
        role="alert"
        class="bg-danger-soft text-danger mb-6 rounded-md px-4 py-3 text-sm"
      >
        {{ error }}
      </p>

      <p v-if="loading" class="text-ink-muted py-16 text-center text-sm">Loading plans…</p>

      <section
        v-else-if="activePlans.length === 0 && archivedPlans.length === 0"
        aria-label="Empty state"
        class="border-line rounded-card border border-dashed py-20 text-center"
      >
        <h2 class="text-lg font-medium">No plans yet</h2>
        <p class="text-ink-muted mx-auto mt-2 max-w-sm text-sm">
          Create your first floor plan and start drawing walls, devices and circuits.
        </p>
        <button
          v-if="!creating"
          type="button"
          class="bg-accent hover:bg-accent-strong mt-5 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
          @click="startCreate"
        >
          Create your first plan
        </button>
      </section>

      <section
        v-else-if="activePlans.length > 0"
        aria-label="Plans"
        class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <PlanCard
          v-for="plan in activePlans"
          :key="plan.id"
          :plan="plan"
          @open="openPlan(plan.id)"
          @rename="(name) => run(() => plansStore.rename(plan.id, name))"
          @duplicate="run(() => plansStore.duplicate(plan.id))"
          @archive="run(() => plansStore.archive(plan.id))"
        />
      </section>

      <section
        v-if="!loading && archivedPlans.length > 0"
        aria-label="Archived plans"
        class="mt-12"
      >
        <details>
          <summary class="text-ink-muted hover:text-ink cursor-pointer text-sm font-medium">
            Archived plans ({{ archivedPlans.length }})
          </summary>
          <ul class="border-line bg-surface rounded-card divide-line mt-3 divide-y border">
            <li
              v-for="plan in archivedPlans"
              :key="plan.id"
              class="flex items-center gap-3 px-4 py-3"
            >
              <div class="min-w-0 flex-1">
                <p class="text-ink-muted truncate text-sm font-medium">{{ plan.name }}</p>
                <p class="text-ink-faint text-xs">
                  Updated {{ formatRelativeTime(plan.updated_at) }}
                </p>
              </div>

              <template v-if="confirmingDeleteId === plan.id">
                <span class="text-danger text-xs">Delete permanently?</span>
                <button
                  type="button"
                  class="bg-danger rounded-md px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  @click="handleDelete(plan.id)"
                >
                  Delete
                </button>
                <button
                  type="button"
                  class="text-ink-muted hover:text-ink rounded-md px-2 py-1 text-xs transition-colors"
                  @click="confirmingDeleteId = null"
                >
                  Cancel
                </button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="text-ink-muted hover:bg-canvas hover:text-ink flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
                  :aria-label="`Restore ${plan.name}`"
                  @click="run(() => plansStore.restore(plan.id))"
                >
                  <ArchiveRestore :size="13" aria-hidden="true" />
                  Restore
                </button>
                <button
                  type="button"
                  class="text-ink-muted hover:bg-danger-soft hover:text-danger flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
                  :aria-label="`Permanently delete ${plan.name}`"
                  @click="confirmDelete(plan.id)"
                >
                  <Trash2 :size="13" aria-hidden="true" />
                  Delete
                </button>
              </template>
            </li>
          </ul>
        </details>
      </section>
    </main>
  </div>
</template>
