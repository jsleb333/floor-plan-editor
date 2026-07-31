import { createRouter, createWebHistory } from 'vue-router'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'plans',
      component: () => import('@/pages/PlansHomePage.vue'),
    },
    {
      path: '/plans/:planId',
      name: 'editor',
      component: () => import('@/pages/EditorPage.vue'),
    },
  ],
})

/** Typed accessor for the editor route's `planId` param. */
export function planIdFromRoute(route: RouteLocationNormalizedLoaded): string {
  const raw = route.params.planId
  return Array.isArray(raw) ? (raw[0] ?? '') : raw
}
