const BASE_URL = '/api'

/** Error thrown by the API client for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function extractDetail(body: string, status: number): string {
  const fallback = `Request failed with status ${status}`
  if (!body) return fallback
  try {
    const data: unknown = JSON.parse(body)
    if (
      typeof data === 'object' &&
      data !== null &&
      'detail' in data &&
      typeof data.detail === 'string'
    ) {
      return data.detail
    }
    return fallback
  } catch {
    return body
  }
}

/**
 * Shared fetch helper for all API modules.
 *
 * Serialises the optional body as JSON — a `FormData` body is sent as-is
 * (multipart, boundary set by the browser) — and throws an {@link ApiError}
 * carrying the HTTP status and the backend's `detail` message on any non-2xx
 * response.
 */
export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = 'GET', body } = options
  const isForm = body instanceof FormData
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new ApiError(response.status, extractDetail(text, response.status))
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}
