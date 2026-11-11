import { api } from "@/lib/api"
import type { Folder, MessageListItem } from "@/lib/types"

export const SEARCH_FIELDS = ["q", "from", "aliasId", "after", "before", "tagId", "read"] as const
export type SearchField = typeof SEARCH_FIELDS[number]
export type SearchFilters = Partial<Record<SearchField, string>>
export type MailboxMode =
  | { kind: "folder"; folder: Folder }
  | { kind: "starred" }
  | { kind: "tag"; tagId: string }
  | { kind: "search"; filters: SearchFilters }

export type MailboxPageData = { items: MessageListItem[]; nextCursor: string | null }

export function searchParamsFor(filters: SearchFilters) {
  const params = new URLSearchParams()
  for (const field of SEARCH_FIELDS) {
    const value = filters[field]?.trim()
    if (value) params.set(field, value)
  }
  return params
}

export function readSearchFilters(params: URLSearchParams): SearchFilters {
  return Object.fromEntries(SEARCH_FIELDS.flatMap((field) => {
    const value = params.get(field)?.trim()
    return value ? [[field, value]] : []
  }))
}

export function mailboxMode(pathname: string, tagId: string | undefined, search: string): MailboxMode {
  if (pathname === "/search") return { kind: "search", filters: readSearchFilters(new URLSearchParams(search)) }
  if (pathname === "/starred") return { kind: "starred" }
  if (tagId) return { kind: "tag", tagId }
  const folder = pathname.slice(1)
  if (folder === "sent" || folder === "trash" || folder === "draft" || folder === "spam" || folder === "archive") {
    return { kind: "folder", folder }
  }
  return { kind: "folder", folder: "inbox" }
}

export function mailboxListEndpoint(mode: MailboxMode, cursor?: string | null) {
  const params = mode.kind === "search" ? searchParamsFor(mode.filters) : new URLSearchParams()
  if (mode.kind === "starred") params.set("starred", "1")
  if (mode.kind === "tag") params.set("tagId", mode.tagId)
  if (mode.kind === "folder") params.set("folder", mode.folder)
  if (cursor) params.set("cursor", cursor)
  return `/api/messages${mode.kind === "search" ? "/search" : ""}?${params}`
}

export type BulkMailboxAction = "read" | "unread" | "tag" | "trash" | "archive" | "unarchive"
export const MAX_BULK_MESSAGES = 50

export function applyMailboxBulk(ids: string[], action: BulkMailboxAction, tagId?: string) {
  return api<{ changed: number; undoToken?: string }>("/api/messages/bulk", {
    method: "POST",
    body: JSON.stringify({ ids, action, tagId }),
  })
}

export function undoMailboxBulk(undoToken: string) {
  return api<{ changed: number }>("/api/messages/bulk/undo", {
    method: "POST",
    body: JSON.stringify({ undoToken }),
  })
}
