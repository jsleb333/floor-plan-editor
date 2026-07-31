/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Persistence backend chosen at build time: `browser` builds the static,
   * IndexedDB-only site; anything else (including unset) keeps the REST
   * backend, so the default dev workflow is untouched.
   */
  readonly VITE_PERSISTENCE?: 'rest' | 'browser'
}
