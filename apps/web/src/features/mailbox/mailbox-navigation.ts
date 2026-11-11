import type { MessageListItem } from "@/lib/types"

export interface MailboxNavigationState {
  mailboxPath: string
  messageIds: string[]
}

type ReturnSnapshot = {
  path: string
  items: MessageListItem[]
  nextCursor: string | null
  scrollTop: number
  savedAt: number
}

let lastOpenedList: ReturnSnapshot | null = null
const refreshListeners = new Set<() => void>()

export function requestMailboxListRefresh() {
  lastOpenedList = null
  refreshListeners.forEach((listener) => listener())
}

export function subscribeMailboxListRefresh(listener: () => void) {
  refreshListeners.add(listener)
  return () => { refreshListeners.delete(listener) }
}

export function saveMailboxReturnSnapshot(snapshot: Omit<ReturnSnapshot, "savedAt">) {
  lastOpenedList = { ...snapshot, savedAt: Date.now() }
}

export function readMailboxReturnSnapshot(path: string) {
  if (lastOpenedList?.path !== path || Date.now() - lastOpenedList.savedAt > 10 * 60_000) {
    return null
  }
  return lastOpenedList
}

export function clearMailboxReturnSnapshot() {
  lastOpenedList = null
}

type MessagePatch = Partial<Pick<MessageListItem, "folder" | "isRead" | "isStarred" | "tagIds">>

export function patchMailboxReturnSnapshot(id: string, patch: MessagePatch | null) {
  if (!lastOpenedList) return
  const [folderPath, query = ""] = lastOpenedList.path.split("?")
  const segment = folderPath?.slice(1)
  const params = new URLSearchParams(query)
  lastOpenedList = {
    ...lastOpenedList,
    items: lastOpenedList.items.flatMap((item) => {
      if (item.id !== id) return [item]
      if (!patch) return []
      const next = { ...item, ...patch }
      if (segment === "starred" && !next.isStarred) return []
      if (segment?.startsWith("tags/") && patch.tagIds && !patch.tagIds.some((tag) => encodeURIComponent(tag) === segment.slice(5))) return []
      if (segment === "search") {
        const read = params.get("read")
        const tag = params.get("tagId")
        if ((read === "1" && !next.isRead) || (read === "0" && next.isRead)) return []
        if (tag && patch.tagIds && !patch.tagIds.includes(tag)) return []
      }
      if (patch.folder) {
        if (segment === item.folder && patch.folder !== item.folder) return []
        if ((segment === "search" || segment === "starred" || segment?.startsWith("tags/")) &&
            (patch.folder === "trash" || patch.folder === "spam" || patch.folder === "draft")) return []
      }
      return [next]
    }),
  }
}
