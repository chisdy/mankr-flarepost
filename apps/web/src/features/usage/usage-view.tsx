import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api, isApiError } from "@/lib/api"
import type { UsageSnapshot } from "@/lib/types"

import { FreeTierCard } from "./free-tier-card"
import { CloudflareCard, SendProviderCard } from "./provider-cards"

export function UsageView() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function reload() {
    setSnapshot(await api<UsageSnapshot>("/api/usage"))
  }

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / locale change
    void reload()
      .catch((err) => {
        if (!cancelled) {
          toast.error(isApiError(err) ? err.message : t("usage.loadFailed"))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  async function refresh() {
    setRefreshing(true)
    try {
      await reload()
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("usage.loadFailed"))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={t("usage.title")}
        description={t("usage.subtitle")}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={loading || refreshing}
            onClick={() => void refresh()}
          >
            <ArrowClockwiseIcon data-icon="inline-start" />
            {refreshing ? t("usage.refreshing") : t("usage.refresh")}
          </Button>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8">
          {loading ? (
            <SendProviderCard usage={undefined} loading />
          ) : (
            (snapshot?.sendProviders ?? []).map((provider) => (
              <SendProviderCard
                key={provider.provider}
                usage={provider}
                loading={false}
              />
            ))
          )}
          <CloudflareCard
            cloudflare={snapshot?.cloudflare}
            fetchedAt={snapshot?.fetchedAt}
            loading={loading}
          />
          <FreeTierCard
            limits={snapshot?.freeTier ?? null}
            sendProviders={snapshot?.sendProviders ?? null}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
