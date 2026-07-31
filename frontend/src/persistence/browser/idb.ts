import { ApiError } from '@/api/client'

/**
 * Promise wrappers over the IndexedDB event API, plus the mapping from its
 * `DOMException` vocabulary onto the {@link ApiError} statuses the rest of the
 * app already branches on.
 *
 * THE AUTO-COMMIT HAZARD — read this before touching a transaction. An
 * IndexedDB transaction commits by itself as soon as the microtask queue drains
 * with none of its requests outstanding. Awaiting an IDB request keeps it
 * alive, because the next request is issued from a microtask chained off the
 * previous request's success event. Awaiting ANYTHING ELSE — a fetch, a timer,
 * `file.arrayBuffer()`, `crypto.subtle` — lets the transaction commit under
 * you, and the next request then throws `TransactionInactiveError`. This is the
 * number-one source of flaky bugs in hand-written IndexedDB code, and it fails
 * intermittently rather than always, so it does not reliably show up in review.
 *
 * The rule this module exists to enforce: every non-IDB step — stamping a date,
 * minting an id, `readPlanDocument`, reading a file's bytes — happens BEFORE
 * `db.transaction(...)`, and the body passed to {@link runTransaction} awaits
 * IDB requests and nothing else.
 */

/** Storage quota exhausted; the browser's analogue of the server running out of disk. */
const INSUFFICIENT_STORAGE_STATUS = 507

/** A uniqueness constraint was violated — a duplicate id, i.e. a write that lost a race. */
const CONFLICT_STATUS = 409

/** Anything else the storage engine reports: the caller cannot act on it. */
const INTERNAL_STATUS = 500

/**
 * The `name` of a thrown storage error. Read structurally rather than through
 * `instanceof DOMException`: the name is the part IndexedDB specifies, and the
 * carrier is not always a real `DOMException` (a synchronous `DataCloneError`
 * from `put` is not, in some implementations).
 */
function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('name' in error)) return ''
  return typeof error.name === 'string' ? error.name : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Classifies a storage failure into the {@link ApiError} contract the ports
 * promise. Unlike the MRU list in `@/stores/deviceMru`, which swallows storage
 * failures because losing it costs the user nothing, a failed plan write must
 * reach the user: this maps the failure, and the adapters let it propagate.
 *
 * @param error Whatever the storage engine rejected or threw with.
 * @returns The error unchanged when it is already an {@link ApiError} (an
 *   adapter's own 404/409 passing back out through a transaction), otherwise a
 *   507 for an exhausted quota, a 409 for a violated uniqueness constraint, and
 *   a 500 for everything else.
 */
export function mapIdbError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  const message = errorMessage(error)
  switch (errorName(error)) {
    case 'QuotaExceededError':
      return new ApiError(
        INSUFFICIENT_STORAGE_STATUS,
        `Browser storage is full, so the change could not be saved: ${message}`,
      )
    case 'ConstraintError':
      return new ApiError(CONFLICT_STATUS, `Local storage rejected a duplicate entry: ${message}`)
    default:
      return new ApiError(INTERNAL_STATUS, `Local storage failed: ${message}`)
  }
}

/** Resolves with a request's result, rejecting with the mapped storage error. */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(mapIdbError(request.error))
    }
  })
}

/**
 * Walks a cursor to its end, collecting the values in the order the cursor
 * yields them. The caller chooses that order through the cursor's direction.
 */
export function collectCursor<T>(request: IDBRequest<IDBCursorWithValue | null>): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const values: T[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor === null) {
        resolve(values)
        return
      }
      values.push(cursor.value as T)
      cursor.continue()
    }
    request.onerror = () => {
      reject(mapIdbError(request.error))
    }
  })
}

/**
 * Adds a value unless its key is already taken — the IndexedDB equivalent of
 * the backend's `INSERT OR IGNORE`, where the oldest copy wins.
 *
 * `preventDefault()` is the load-bearing call: an errored request otherwise
 * propagates to the transaction and aborts every write that shares it.
 *
 * @returns Whether the value was inserted, i.e. whether the key was free.
 */
export function addIfAbsent(store: IDBObjectStore, value: unknown): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = store.add(value)
    request.onsuccess = () => {
      resolve(true)
    }
    request.onerror = (event) => {
      if (errorName(request.error) !== 'ConstraintError') {
        reject(mapIdbError(request.error))
        return
      }
      event.preventDefault()
      event.stopPropagation()
      resolve(false)
    }
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onabort = () => {
      reject(mapIdbError(transaction.error))
    }
    transaction.onerror = () => {
      reject(mapIdbError(transaction.error))
    }
  })
}

function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort()
  } catch {
    // Already finished: there is nothing left to roll back.
  }
}

/**
 * Runs `body` inside one transaction and resolves once that transaction has
 * COMMITTED, not merely once the last request succeeded — the difference is
 * whether a caller awaiting the result can rely on the data being durable.
 *
 * `body` may only await IDB requests (see the auto-commit hazard at the top of
 * this module). When it throws, the transaction is rolled back and the error is
 * mapped, so a caller only ever sees an {@link ApiError}.
 *
 * @param db Open connection the transaction is taken on.
 * @param storeNames Object stores the transaction spans; listing several is how
 *   writes across them commit atomically.
 * @param mode `'readonly'` unless the body writes.
 * @param body Receives the transaction and issues its requests.
 */
export async function runTransaction<T>(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const transaction = db.transaction(storeNames, mode)
  const done = transactionDone(transaction)
  let result: T
  try {
    result = await body(transaction)
  } catch (error) {
    done.catch(() => {})
    abortQuietly(transaction)
    throw mapIdbError(error)
  }
  await done
  return result
}
