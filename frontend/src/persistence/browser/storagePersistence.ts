/**
 * The one request the static build makes of the browser it lives in: keep this
 * origin's storage out of eviction.
 *
 * WHY THIS MODULE SWALLOWS EVERYTHING. Every other module under
 * `persistence/browser/` deliberately does the opposite — a failed plan write
 * is mapped to an {@link import('@/api/client').ApiError} and propagated,
 * because the user has to know their work did not land. This one follows
 * `@/stores/deviceMru` instead: persistence is a hint the browser is free to
 * refuse, refusing costs the user nothing they can act on, and a rejected
 * promise here would surface as a scary failure for a request that was never
 * a promise to begin with. So it resolves `false` and the caller carries on.
 */

/**
 * localStorage key recording that this origin already asked once.
 *
 * A browser that declines (or a user who dismisses the prompt) must not be
 * asked again on every save for the rest of time; a permission dialog the user
 * did not ask for is hostile the first time and intolerable the tenth.
 */
const REQUESTED_KEY = 'floor-plan:storage-persistence-requested'

function alreadyRequested(): boolean {
  try {
    return window.localStorage.getItem(REQUESTED_KEY) !== null
  } catch {
    // Private mode or a blocked storage partition: treat it as never asked.
    // Asking twice is a nuisance; never asking at all loses the plans.
    return false
  }
}

function rememberRequested(): void {
  try {
    window.localStorage.setItem(REQUESTED_KEY, '1')
  } catch {
    // Nothing to do: the flag is an optimisation, not a correctness condition.
  }
}

/**
 * Asks the browser to keep this origin's storage out of eviction. Best effort:
 * browsers decide by engagement heuristics and may prompt, so this is called
 * once after the user's first successful write — never at startup, where there
 * is nothing to protect yet and an unprompted permission dialog is hostile.
 *
 * @returns Whether the origin's storage is persistent when this resolves —
 *   `true` if it already was or the browser just granted it, `false` if the
 *   API is missing, the request was declined, or one was already made.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    // `navigator.storage` is typed as always present but is absent in older
    // browsers and in test environments, so the type is widened to the truth.
    const storage: StorageManager | undefined = navigator.storage
    if (typeof storage?.persist !== 'function') return false
    if (await storage.persisted()) return true
    if (alreadyRequested()) return false
    // Recorded BEFORE the request: a prompt the user closes by reloading the
    // tab never resolves, and must still count as having been asked.
    rememberRequested()
    return await storage.persist()
  } catch {
    return false
  }
}
