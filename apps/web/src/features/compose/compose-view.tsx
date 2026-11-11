import { zodResolver } from "@hookform/resolvers/zod"
import {
  Delete02Icon,
  FloppyDiskIcon,
  SentIcon,
} from "@hugeicons/core-free-icons"

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { Icon } from "@/components/icon"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RichTextEditor } from "@/features/compose/rich-text-editor"
import { api, isApiError } from "@/lib/api"
import {
  forwardSubject,
  quoteForwardBody,
  quoteReplyBody,
  replySubject,
} from "@/lib/format"
import { htmlHasText, htmlToText, textToHtml } from "@/lib/html-text"
import { invalidateMailboxMetadata } from "@/lib/mailbox-metadata"
import type { Alias, MessageDetail } from "@/lib/types"

import {
  DraftQueue,
  fingerprintSendBody,
  forgetSendAttempt,
  readSendAttempt,
  rememberSendAttempt,
  retryBody,
  type SendAttempt,
} from "./compose-persistence"

type ComposeValues = {
  fromAliasId: string
  to: string
  subject: string
  html: string
}

const AUTOSAVE_MS = 1500

function draftPayload(values: ComposeValues) {
  return {
    fromAliasId: values.fromAliasId,
    to: values.to.split(/[,;\s]+/).filter(Boolean),
    subject: values.subject,
    text: htmlToText(values.html),
    html: values.html,
  }
}

type AcceptedSend = { status: "accepted"; saved: boolean }
type SendNotice =
  "unknown" | "processing" | "acceptedPending" | "retryAvailable" | "conflict"

export function ComposeView() {
  const { state } = useLocation()
  const [params] = useSearchParams()
  const composeKey =
    typeof state?.composeKey === "string" ? state.composeKey : params.toString()
  return <ComposeEditor key={composeKey} composeKey={composeKey} />
}

function ComposeEditor({ composeKey }: { composeKey: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const replyId = params.get("reply")
  const forwardId = params.get("forward")
  const draftIdParam = params.get("draft")

  const [aliases, setAliases] = useState<Alias[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [deletingDraft, setDeletingDraft] = useState(false)
  const [draftId, setDraftId] = useState<string | undefined>(
    draftIdParam ?? undefined
  )
  const [pendingSend, setPendingSend] = useState(() =>
    draftIdParam ? readSendAttempt(draftIdParam) : null
  )
  const [sendNotice, setSendNotice] = useState<SendNotice>(
    pendingSend?.accepted ? "acceptedPending" : "unknown"
  )
  const [editorKey, setEditorKey] = useState(0)
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle")
  const [savedValues, setSavedValues] = useState<ComposeValues | null>(null)
  const draftIdRef = useRef(draftId)
  const queue = useRef(new DraftQueue()).current
  const mounted = useRef(false)
  const operation = useRef(false)
  const pendingRef = useRef(pendingSend)
  const lastSaved = useRef<string | null>(null)
  const hasEdited = useRef(false)
  const restoredSendBody = useRef<string | undefined>(undefined)
  /** Draft id already loaded into the form (avoids reload after autosave sets ?draft=). */
  const hydratedDraftRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const composeSchema = useMemo(
    () =>
      z.object({
        fromAliasId: z.string().min(1, t("compose.selectFrom")),
        to: z
          .string()
          .trim()
          .refine((value) => {
            if (!value) return true
            return value
              .split(/[,;\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .every((addr) => addr.includes("@"))
          }, t("compose.toInvalid")),
        subject: z.string(),
        html: z.string(),
      }),
    [t]
  )

  const sendSchema = useMemo(
    () =>
      composeSchema.extend({
        to: z
          .string()
          .trim()
          .min(1, t("compose.toRequired"))
          .refine(
            (value) =>
              value
                .split(/[,;\s]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .every((addr) => addr.includes("@")),
            t("compose.toInvalid")
          ),
        html: z
          .string()
          .refine((v) => htmlHasText(v), t("compose.bodyRequired")),
      }),
    [composeSchema, t]
  )

  const form = useForm<ComposeValues>({
    resolver: zodResolver(composeSchema),
    defaultValues: {
      fromAliasId: "",
      to: "",
      subject: "",
      html: "",
    },
  })

  const watched = useWatch({ control: form.control })
  const { isDirty } = form.formState

  const aliasItems = useMemo(
    () =>
      aliases.map((alias) => ({
        label: `${alias.address}${alias.isDefault ? t("compose.defaultSuffix") : ""}`,
        value: alias.id,
      })),
    [aliases, t]
  )

  const title = draftIdParam
    ? t("compose.draftTitle")
    : forwardId
      ? t("compose.forwardTitle")
      : replyId
        ? t("compose.replyTitle")
        : t("compose.title")

  const bootstrapTranslation = useEffectEvent(() => t)
  useEffect(() => {
    const t = bootstrapTranslation()
    let cancelled = false

    // Autosave may navigate to ?draft=id; don't wipe the in-progress editor.
    if (
      draftIdParam &&
      hydratedDraftRef.current === draftIdParam &&
      !replyId &&
      !forwardId
    ) {
      setLoading(false)
      return
    }

    async function bootstrap() {
      setLoading(true)
      try {
        const { aliases: list } = await api<{ aliases: Alias[] }>(
          "/api/aliases"
        )
        if (cancelled) return

        const enabled = list.filter((a) => a.enabled)
        setAliases(enabled)

        const defaultAlias =
          enabled.find((a) => a.isDefault) ?? enabled[0] ?? null

        let defaults: ComposeValues = {
          fromAliasId: defaultAlias?.id ?? "",
          to: "",
          subject: "",
          html: "",
        }
        let storedPayload: string | undefined

        if (draftIdParam) {
          const original = await api<MessageDetail>(
            `/api/messages/${draftIdParam}`
          )
          if (cancelled) return
          if (original.folder !== "draft") {
            toast.error(t("compose.notADraft"))
            navigate("/draft", { replace: true })
            return
          }
          const draftAlias =
            enabled.find((a) => a.id === original.aliasId) ?? defaultAlias
          defaults = {
            fromAliasId: draftAlias?.id ?? "",
            to: original.toAddrs.join(", "),
            subject: original.subject,
            html: original.htmlBody || textToHtml(original.textBody),
          }
          setDraftId(original.id)
          draftIdRef.current = original.id
          hydratedDraftRef.current = original.id
          const stored = {
            fromAliasId: original.aliasId,
            to: original.toAddrs,
            subject: original.subject,
            text: original.textBody,
            html: original.htmlBody,
          }
          storedPayload = JSON.stringify(stored)
          restoredSendBody.current = JSON.stringify({
            ...stored,
            html: stored.html ?? "",
            draftId: original.id,
          })
        } else if (replyId) {
          const original = await api<MessageDetail>(`/api/messages/${replyId}`)
          if (cancelled) return
          const replyAlias =
            enabled.find((a) => a.id === original.aliasId) ?? defaultAlias
          const quote = quoteReplyBody(
            original.fromAddr,
            original.createdAt,
            original.textBody,
            (when, from) => t("compose.quoteHeader", { when, from })
          )
          defaults = {
            fromAliasId: replyAlias?.id ?? "",
            to: original.replyToAddrs?.length
              ? original.replyToAddrs.join(", ")
              : original.fromAddr,
            subject: replySubject(original.subject, t("app.noSubject")),
            html: textToHtml(quote),
          }
        } else if (forwardId) {
          const original = await api<MessageDetail>(
            `/api/messages/${forwardId}`
          )
          if (cancelled) return
          const forwardAlias =
            enabled.find((a) => a.id === original.aliasId) ?? defaultAlias
          const quote = quoteForwardBody(
            original.fromAddr,
            original.toAddrs,
            original.createdAt,
            original.subject || t("app.noSubject"),
            original.textBody,
            {
              from: t("message.from"),
              to: t("message.to"),
              date: t("message.date"),
              subject: t("compose.subject"),
            }
          )
          defaults = {
            fromAliasId: forwardAlias?.id ?? "",
            to: "",
            subject: forwardSubject(original.subject, t("app.noSubject")),
            html: textToHtml(quote),
          }
        }

        lastSaved.current =
          storedPayload ?? JSON.stringify(draftPayload(defaults))
        form.reset(defaults)
        setEditorKey((k) => k + 1)
      } catch (err) {
        if (!cancelled && !pendingRef.current) {
          toast.error(isApiError(err) ? err.message : t("compose.loadFailed"))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [replyId, forwardId, draftIdParam, form, navigate])

  async function persistDraft(values: ComposeValues) {
    const payload = JSON.stringify(draftPayload(values))
    const currentId = draftIdRef.current
    if (currentId) {
      if (payload !== lastSaved.current) {
        await api(`/api/messages/drafts/${currentId}`, {
          method: "PUT",
          body: payload,
        })
        lastSaved.current = payload
      }
      return currentId
    }

    const { id } = await api<{ id: string }>("/api/messages/drafts", {
      method: "POST",
      body: payload,
    })
    lastSaved.current = payload
    draftIdRef.current = id
    invalidateMailboxMetadata()
    if (mounted.current) {
      hydratedDraftRef.current = id
      setDraftId(id)
      navigate(`/compose?draft=${id}`, { replace: true, state: { composeKey } })
    }
    return id
  }

  async function saveDraft() {
    if (operation.current || pendingRef.current) return
    if (!form.getValues("fromAliasId")) {
      toast.error(t("compose.selectFrom"))
      return
    }
    setSavingDraft(true)
    try {
      await queue.run(() => persistDraft(form.getValues()))
      if (mounted.current) toast.success(t("compose.draftSaved"))
    } catch (err) {
      if (mounted.current)
        toast.error(
          isApiError(err) ? err.message : t("compose.draftSaveFailed")
        )
    } finally {
      if (mounted.current) setSavingDraft(false)
    }
  }

  useEffect(() => {
    if (
      loading ||
      pendingSend ||
      !watched.fromAliasId ||
      lastSaved.current === null ||
      (!isDirty && !hasEdited.current)
    )
      return
    hasEdited.current = true
    const timer = window.setTimeout(() => {
      void queue.run(async () => {
        if (!mounted.current || operation.current || pendingRef.current) return
        const latest = form.getValues()
        const payload = JSON.stringify(draftPayload(latest))
        if (payload === lastSaved.current || !latest.fromAliasId) return
        setAutoSaveStatus("saving")
        try {
          await persistDraft(latest)
          if (mounted.current) {
            setSavedValues({ ...latest })
            setAutoSaveStatus("saved")
          }
        } catch {
          if (mounted.current) setAutoSaveStatus("error")
        }
      })
    }, AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
    // The queued callback reads the current form and operation state when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading,
    pendingSend,
    submitting,
    deletingDraft,
    isDirty,
    watched.fromAliasId,
    watched.to,
    watched.subject,
    watched.html,
  ])

  async function deleteCurrentDraft() {
    if (!draftId || operation.current || pendingRef.current) return
    if (!window.confirm(t("compose.deleteDraftConfirm"))) return

    operation.current = true
    setDeletingDraft(true)
    try {
      await queue.settled()
      await api(`/api/messages/drafts/${draftId}`, { method: "DELETE" })
      invalidateMailboxMetadata()
      if (mounted.current) {
        toast.success(t("compose.draftDeleted"))
        navigate("/draft", { replace: true })
      }
    } catch (err) {
      if (mounted.current)
        toast.error(
          isApiError(err) ? err.message : t("compose.draftDeleteFailed")
        )
    } finally {
      operation.current = false
      if (mounted.current) setDeletingDraft(false)
    }
  }

  function trackAttempt(attempt: SendAttempt | null) {
    if (attempt) rememberSendAttempt(attempt)
    else if (pendingRef.current) forgetSendAttempt(pendingRef.current)
    pendingRef.current = attempt
    if (mounted.current) setPendingSend(attempt)
  }

  function finishSend(attempt: SendAttempt) {
    if (pendingRef.current?.key === attempt.key) trackAttempt(null)
    invalidateMailboxMetadata()
    if (mounted.current) {
      toast.success(t("compose.sent"))
      navigate("/sent", { replace: true })
    }
  }

  async function inspectSend(attempt: SendAttempt, dispatch: boolean) {
    const statusPath = `/api/messages/send/${encodeURIComponent(attempt.key)}`
    try {
      const result = dispatch
        ? await api<AcceptedSend>("/api/messages/send", {
            method: "POST",
            headers: { "Idempotency-Key": attempt.key },
            body: attempt.body,
            signal: AbortSignal.timeout(45_000),
          })
        : await api<AcceptedSend>(statusPath, {
            signal: AbortSignal.timeout(15_000),
          })
      if (!result.saved) {
        trackAttempt({ ...attempt, accepted: true })
        if (mounted.current) setSendNotice("acceptedPending")
        try {
          const recovered = await api<AcceptedSend>(`${statusPath}/reconcile`, {
            method: "POST",
            signal: AbortSignal.timeout(15_000),
          })
          if (recovered.saved) finishSend(attempt)
        } catch {
          // The provider already accepted. Keep the draft locked until local history is saved.
        }
        return
      }
      finishSend(attempt)
    } catch (err) {
      const body = isApiError(err)
        ? (err.body as { error?: string; status?: string; requestKey?: string })
        : null
      if (attempt.accepted) {
        if (mounted.current) setSendNotice("acceptedPending")
      } else if (body?.error === "draft_send_exists" && body.requestKey) {
        trackAttempt({ draftId: attempt.draftId, key: body.requestKey })
        if (mounted.current) setSendNotice("processing")
      } else if (
        body?.status === "failed" ||
        (dispatch &&
          [
            "invalid_idempotency_key",
            "invalid_address",
            "invalid_draft",
            "invalid_body",
            "rate_limited",
            "send_message_too_large",
          ].includes(body?.error ?? ""))
      ) {
        trackAttempt(null)
        if (mounted.current)
          toast.error(
            t(`compose.errors.${body?.error}`, {
              defaultValue: t("compose.sendFailed"),
            })
          )
      } else if (!dispatch && body?.error === "send_not_found") {
        const exactBody = await retryBody(
          attempt,
          restoredSendBody.current
        ).catch(() => undefined)
        if (exactBody) trackAttempt({ ...attempt, body: exactBody })
        if (mounted.current)
          setSendNotice(exactBody ? "retryAvailable" : "unknown")
      } else if (mounted.current) {
        setSendNotice(
          body?.error === "send_processing"
            ? "processing"
            : body?.error === "idempotency_conflict"
              ? "conflict"
              : "unknown"
        )
      }
    }
  }

  async function recoverSend(dispatch = false) {
    const attempt = pendingRef.current
    if (!attempt || operation.current || (dispatch && !attempt.body)) return
    operation.current = true
    setSubmitting(true)
    try {
      await inspectSend(attempt, dispatch)
    } finally {
      operation.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  const checkRestoredSend = useEffectEvent(() => {
    if (pendingRef.current) void recoverSend()
  })
  const restoredSendChecked = useRef(false)
  useEffect(() => {
    if (loading || restoredSendChecked.current) return
    restoredSendChecked.current = true
    checkRestoredSend()
  }, [loading])

  async function onSubmit(values: ComposeValues) {
    if (operation.current || pendingRef.current) return
    const parsed = sendSchema.safeParse(values)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (field === "to" || field === "html" || field === "fromAliasId") {
          form.setError(field, { message: issue.message })
        }
      }
      return
    }

    operation.current = true
    setSubmitting(true)
    try {
      const id = await queue.run(() => persistDraft(parsed.data))
      if (!mounted.current) return
      const body = JSON.stringify({ ...draftPayload(parsed.data), draftId: id })
      const attempt = {
        draftId: id,
        key: crypto.randomUUID(),
        fingerprint: await fingerprintSendBody(body),
        body,
      }
      if (!mounted.current) return
      trackAttempt(attempt)
      setSendNotice("processing")
      await inspectSend(attempt, true)
    } catch {
      if (mounted.current) toast.error(t("compose.sendPreparationFailed"))
    } finally {
      operation.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {t("app.loading")}
      </div>
    )
  }

  if (aliases.length === 0 && !pendingSend) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <PageHeader title={t("compose.title")} />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-4 py-6 sm:px-6">
            <p className="text-sm text-muted-foreground">
              {t("compose.needAlias")}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => navigate("/settings?tab=mail")}
            >
              {t("compose.manageAliases")}
            </Button>
          </div>
        </ScrollArea>
      </div>
    )
  }

  const saveIsCurrent =
    savedValues &&
    (Object.keys(savedValues) as Array<keyof ComposeValues>).every(
      (field) => savedValues[field] === watched[field]
    )
  const autoSaveLabel = pendingSend
    ? null
    : autoSaveStatus === "saving"
      ? t("compose.autoSaving")
      : autoSaveStatus === "saved" && saveIsCurrent
        ? t("compose.autoSaved")
        : autoSaveStatus === "error"
          ? t("compose.autoSaveFailed")
          : null
  const frozen = Boolean(pendingSend) || submitting || deletingDraft

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={title}
        actions={
          autoSaveLabel ? (
            <span
              role="status"
              className={
                autoSaveStatus === "error"
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {autoSaveLabel}
            </span>
          ) : null
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <form
          className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-9 sm:py-9"
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        >
          {pendingSend ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-border px-4 py-3">
              <p role="status" className="text-sm text-foreground">
                {t(`compose.sendStatus.${sendNotice}`)}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() =>
                  void recoverSend(sendNotice === "retryAvailable")
                }
              >
                {t(
                  submitting
                    ? "compose.checkingSend"
                    : sendNotice === "retryAvailable"
                      ? "compose.resumeSend"
                      : "compose.checkSend"
                )}
              </Button>
            </div>
          ) : null}

          <fieldset disabled={frozen} className="min-w-0">
            <FieldGroup>
              <Field
                data-invalid={!!form.formState.errors.fromAliasId || undefined}
              >
                <FieldLabel htmlFor="compose-from">
                  {t("compose.from")}
                </FieldLabel>
                <Controller
                  control={form.control}
                  name="fromAliasId"
                  render={({ field }) => (
                    <Select
                      disabled={frozen}
                      items={aliasItems}
                      value={field.value || null}
                      onValueChange={(value) => field.onChange(value ?? "")}
                    >
                      <SelectTrigger
                        id="compose-from"
                        className="w-full"
                        aria-invalid={!!form.formState.errors.fromAliasId}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {aliasItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[form.formState.errors.fromAliasId]} />
              </Field>

              <Field data-invalid={!!form.formState.errors.to || undefined}>
                <FieldLabel htmlFor="compose-to">{t("compose.to")}</FieldLabel>
                <Input
                  id="compose-to"
                  placeholder={t("compose.toPlaceholder")}
                  autoComplete="email"
                  aria-invalid={!!form.formState.errors.to}
                  {...form.register("to")}
                />
                <FieldDescription>{t("compose.toHint")}</FieldDescription>
                <FieldError errors={[form.formState.errors.to]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="compose-subject">
                  {t("compose.subject")}
                </FieldLabel>
                <Input id="compose-subject" {...form.register("subject")} />
              </Field>

              <Field data-invalid={!!form.formState.errors.html || undefined}>
                <FieldLabel htmlFor="compose-editor">
                  {t("compose.body")}
                </FieldLabel>
                <Controller
                  control={form.control}
                  name="html"
                  render={({ field }) => (
                    <RichTextEditor
                      key={editorKey}
                      id="compose-editor"
                      value={field.value}
                      onChange={field.onChange}
                      readOnly={frozen}
                      invalid={!!form.formState.errors.html}
                    />
                  )}
                />
                <FieldError errors={[form.formState.errors.html]} />
              </Field>
            </FieldGroup>
          </fieldset>

          <div className="flex flex-wrap gap-2 pt-4">
            <Button type="submit" disabled={frozen || savingDraft}>
              <Icon icon={SentIcon} data-icon="inline-start" />
              {submitting ? t("compose.sending") : t("compose.send")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={frozen || savingDraft}
              onClick={() => void saveDraft()}
            >
              <Icon icon={FloppyDiskIcon} data-icon="inline-start" />
              {savingDraft ? t("compose.savingDraft") : t("compose.saveDraft")}
            </Button>
            {draftId ? (
              <Button
                type="button"
                variant="outline"
                disabled={frozen || savingDraft}
                onClick={() => void deleteCurrentDraft()}
              >
                <Icon icon={Delete02Icon} data-icon="inline-start" />
                {deletingDraft
                  ? t("compose.deletingDraft")
                  : t("compose.deleteDraft")}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
              {t("app.cancel")}
            </Button>
          </div>
        </form>
      </ScrollArea>
    </div>
  )
}
