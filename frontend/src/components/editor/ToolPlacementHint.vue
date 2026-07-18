<script setup lang="ts">
defineProps<{
  title: string
  /** Placement instructions, one paragraph per line. */
  lines: readonly string[]
}>()
</script>

<template>
  <section :aria-label="`${title} tool instructions`" class="flex flex-col gap-2 text-xs">
    <h3 class="text-ink text-sm font-semibold">{{ title }}</h3>
    <p v-for="line in lines" :key="line" class="text-ink-muted leading-relaxed">
      {{ line }}
    </p>
  </section>
</template>
