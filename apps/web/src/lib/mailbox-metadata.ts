import { useEffect, useSyncExternalStore } from "react"

import { api } from "@/lib/api"
import type { Alias, FolderCounts, Tag } from "@/lib/types"

type ResourceSnapshot<T> = { data: T | null; failed: boolean }
const empty: ResourceSnapshot<never> = { data: null, failed: false }

function createResource<T>(load: (signal: AbortSignal) => Promise<T>, ttl: number) {
  let snapshot: ResourceSnapshot<T> = empty
  let expiresAt = 0
  let request: AbortController | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())

  function refresh() {
    if (request || expiresAt > Date.now()) return
    const controller = new AbortController()
    request = controller
    if (snapshot.failed) {
      snapshot = { ...snapshot, failed: false }
      emit()
    }
    void load(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        snapshot = { data: result, failed: false }
        expiresAt = Date.now() + ttl
        emit()
      })
      .catch(() => {
        if (controller.signal.aborted) return
        snapshot = { ...snapshot, failed: true }
        emit()
      })
      .finally(() => {
        if (request === controller) request = null
      })
  }

  function expire() {
    request?.abort()
    request = null
    expiresAt = 0
  }

  return {
    refresh,
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    invalidate() {
      expire()
      if (listeners.size) refresh()
    },
    reset() {
      expire()
      snapshot = empty
      emit()
    },
  }
}

const resources = {
  counts: createResource((signal) => api<FolderCounts>("/api/messages/counts", { signal }), 30_000),
  tags: createResource((signal) => api<{ tags: Tag[] }>("/api/tags", { signal }).then((r) => r.tags), 120_000),
  aliases: createResource((signal) => api<{ aliases: Alias[] }>("/api/aliases", { signal }).then((r) => r.aliases), 120_000),
}

function useResource<T>(resource: ReturnType<typeof createResource<T>>, enabled: boolean) {
  const value = useSyncExternalStore(resource.subscribe, resource.snapshot)
  useEffect(() => {
    if (!enabled) return
    resource.refresh()
    window.addEventListener("focus", resource.refresh)
    return () => window.removeEventListener("focus", resource.refresh)
  }, [enabled, resource])
  return enabled ? value : empty
}

export const useMailboxCounts = () => useResource(resources.counts, true).data
export const useMailboxTags = (enabled = true) => useResource(resources.tags, enabled).data
export const useMailboxTagState = (enabled = true) => useResource(resources.tags, enabled)
export const useMailboxAliasState = (enabled = true) => useResource(resources.aliases, enabled)

export function invalidateMailboxMetadata(...keys: Array<keyof typeof resources>) {
  for (const key of keys.length ? keys : ["counts"] as const) resources[key].invalidate()
}

export function resetMailboxMetadata() {
  Object.values(resources).forEach((resource) => resource.reset())
}
