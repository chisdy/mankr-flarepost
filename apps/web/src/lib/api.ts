import type { ApiErrorBody } from "@/lib/types"

export class ApiError extends Error {
  status: number
  body: ApiErrorBody

  constructor(message: string, status: number, body: ApiErrorBody) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData
  if (!isForm && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(body.message || res.statusText || "Request failed", res.status, body)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** Download an attachment with session cookie and trigger a browser save. */
export async function downloadAttachment(id: string, filename: string): Promise<void> {
  const res = await fetch(`/api/attachments/${id}`, { credentials: "include" })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(body.message || res.statusText || "Request failed", res.status, body)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
