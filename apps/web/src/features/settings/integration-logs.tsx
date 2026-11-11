import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api, isApiError } from "@/lib/api"
import type { ApiKey, ApiSendLog } from "@/lib/types"

type LogPage = { logs: ApiSendLog[]; nextCursor: string | null }

export function IntegrationLogs({
  keys,
  revision,
}: {
  keys: ApiKey[]
  revision: number
}) {
  const { t, i18n } = useTranslation()
  const [keyId, setKeyId] = useState("all")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState<LogPage>({ logs: [], nextCursor: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const keyItems = [
    { value: "all", label: t("integrations.allProjects") },
    ...keys.map((key) => ({ value: key.id, label: key.name })),
  ]
  const statusItems = [
    { value: "all", label: t("integrations.allStatuses") },
    { value: "sent", label: t("integrations.accepted") },
    { value: "failed", label: t("integrations.failed") },
  ]
  const query = new URLSearchParams({ limit: "25" })
  if (keyId !== "all") query.set("apiKeyId", keyId)
  if (status !== "all") query.set("status", status)
  const url = `/api/api-send-logs?${query}`

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset a server page when its query changes
    setLoading(true)
    setError("")
    api<LogPage>(url)
      .then((data) => {
        if (!cancelled) setPage(data)
      })
      .catch((err) => {
        if (!cancelled)
          setError(isApiError(err) ? err.message : t("integrations.logsFailed"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [url, refresh, revision, t])

  async function more() {
    if (!page.nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await api<LogPage>(
        `${url}&cursor=${encodeURIComponent(page.nextCursor)}`
      )
      setPage((current) => ({
        logs: [...current.logs, ...data.logs],
        nextCursor: data.nextCursor,
      }))
    } catch (err) {
      setError(isApiError(err) ? err.message : t("integrations.logsFailed"))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("integrations.logs")}</CardTitle>
        <CardDescription>{t("integrations.logsHint")}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select
            disabled={loadingMore}
            items={keyItems}
            value={keyId}
            onValueChange={(value) => setKeyId(value ?? "all")}
          >
            <SelectTrigger
              aria-label={t("integrations.projectFilter")}
              className="w-full sm:w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {keyItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            disabled={loadingMore}
            items={statusItems}
            value={status}
            onValueChange={(value) => setStatus(value ?? "all")}
          >
            <SelectTrigger
              aria-label={t("integrations.statusFilter")}
              className="w-full sm:w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={loading || loadingMore}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("integrations.refresh")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
        ) : error ? null : page.logs.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t("integrations.noLogs")}
          </p>
        ) : (
          <ul className="space-y-3">
            {page.logs.map((log) => (
              <li
                key={log.id}
                className="space-y-2 rounded-xl bg-muted/40 p-4 text-xs break-words"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>
                    {log.projectName} · {log.keyPrefix}…
                  </strong>
                  <span>
                    {log.errorCode === "outcome_unknown"
                      ? t("integrations.unknown")
                      : log.status === "sent"
                        ? t("integrations.accepted")
                        : t("integrations.failed")}
                  </span>
                </div>
                <p>
                  {log.fromAddr} → {log.toAddrs.join(", ")}
                </p>
                <p className="font-medium">
                  {log.subject || t("integrations.noSubject")}
                </p>
                <p className="text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString(i18n.language)}
                </p>
                {log.errorCode ? (
                  <p className="text-destructive">{log.errorCode}</p>
                ) : null}
                <p className="font-mono break-all text-muted-foreground">
                  ID: {log.id}
                  {log.providerMessageId
                    ? ` · Provider: ${log.providerMessageId}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {!loading && page.nextCursor ? (
          <Button
            disabled={loadingMore}
            variant="outline"
            onClick={() => void more()}
          >
            {loadingMore ? t("app.loading") : t("integrations.loadMore")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
