import { zodResolver } from "@hookform/resolvers/zod"
import { FloppyDiskIcon, PaperPlaneTiltIcon, TrashIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

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
import type { Alias, MessageDetail, SendErrorCode } from "@/lib/types"

type ComposeValues = {
  fromAliasId: string
  to: string
  subject: string
  html: string
}

const AUTOSAVE_MS = 1500

export function ComposeView() {
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
  const [replyToMessageId, setReplyToMessageId] = useState<string | undefined>()
  const [draftId, setDraftId] = useState<string | undefined>(draftIdParam ?? undefined)
  const [editorKey, setEditorKey] = useState(0)
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  )
  const draftIdRef = useRef(draftId)
  const savingRef = useRef(false)
  const skipAutoSaveRef = useRef(true)
  const bootstrapDoneRef = useRef(false)
  /** Draft id already loaded into the form (avoids reload after autosave sets ?draft=). */
  const hydratedDraftRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    draftIdRef.current = draftId
  }, [draftId])

  const composeSchema = useMemo(
    () =>
      z.object({
        fromAliasId: z.string().min(1, t("compose.selectFrom")),
        to: z
          .string()
          .trim()
          .refine(
            (value) => {
              if (!value) return true
              return value
                .split(/[,;\s]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .every((addr) => addr.includes("@"))
            },
            t("compose.toInvalid")
          ),
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
        html: z.string().refine((v) => htmlHasText(v), t("compose.bodyRequired")),
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

  useEffect(() => {
    let cancelled = false

    // Autosave may navigate to ?draft=id; don't wipe the in-progress editor.
    if (
      draftIdParam &&
      hydratedDraftRef.current === draftIdParam &&
      !replyId &&
      !forwardId
    ) {
      skipAutoSaveRef.current = false
      bootstrapDoneRef.current = true
      setLoading(false)
      return
    }

    bootstrapDoneRef.current = false
    skipAutoSaveRef.current = true

    async function bootstrap() {
      setLoading(true)
      try {
        const { aliases: list } = await api<{ aliases: Alias[] }>("/api/aliases")
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

        if (draftIdParam) {
          const original = await api<MessageDetail>(`/api/messages/${draftIdParam}`)
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
          hydratedDraftRef.current = original.id
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
            to: original.fromAddr,
            subject: replySubject(original.subject, t("app.noSubject")),
            html: textToHtml(quote),
          }
          setReplyToMessageId(original.id)
        } else if (forwardId) {
          const original = await api<MessageDetail>(`/api/messages/${forwardId}`)
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

        form.reset(defaults)
        setEditorKey((k) => k + 1)
        bootstrapDoneRef.current = true
        // Allow autosave after user edits (next tick after watch settles)
        window.setTimeout(() => {
          if (!cancelled) skipAutoSaveRef.current = false
        }, 0)
      } catch (err) {
        toast.error(isApiError(err) ? err.message : t("compose.loadFailed"))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [replyId, forwardId, draftIdParam, form, t, navigate])

  function parseRecipients(value: string): string[] {
    return value
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  async function persistDraft(
    values: ComposeValues,
    opts: { silent: boolean }
  ): Promise<boolean> {
    if (!values.fromAliasId) {
      if (!opts.silent) toast.error(t("compose.selectFrom"))
      return false
    }

    const payload = {
      fromAliasId: values.fromAliasId,
      to: parseRecipients(values.to),
      subject: values.subject,
      text: htmlToText(values.html),
      html: values.html,
    }

    if (opts.silent) setAutoSaveStatus("saving")
    else setSavingDraft(true)

    try {
      const currentId = draftIdRef.current
      if (currentId) {
        await api(`/api/messages/drafts/${currentId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
      } else {
        const result = await api<{ id: string }>("/api/messages/drafts", {
          method: "POST",
          body: JSON.stringify(payload),
        })
        setDraftId(result.id)
        draftIdRef.current = result.id
        hydratedDraftRef.current = result.id
        navigate(`/compose?draft=${result.id}`, { replace: true })
      }
      if (opts.silent) setAutoSaveStatus("saved")
      else toast.success(t("compose.draftSaved"))
      return true
    } catch (err) {
      if (opts.silent) setAutoSaveStatus("error")
      else toast.error(isApiError(err) ? err.message : t("compose.draftSaveFailed"))
      return false
    } finally {
      if (!opts.silent) setSavingDraft(false)
    }
  }

  async function saveDraft() {
    await persistDraft(form.getValues(), { silent: false })
  }

  // Debounced auto-save
  useEffect(() => {
    if (loading || skipAutoSaveRef.current || !bootstrapDoneRef.current) return
    if (!watched.fromAliasId) return

    const timer = window.setTimeout(() => {
      if (savingRef.current || submitting || deletingDraft) return
      savingRef.current = true
      void persistDraft(
        {
          fromAliasId: watched.fromAliasId ?? "",
          to: watched.to ?? "",
          subject: watched.subject ?? "",
          html: watched.html ?? "",
        },
        { silent: true }
      ).finally(() => {
        savingRef.current = false
      })
    }, AUTOSAVE_MS)

    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistDraft uses latest refs/form
  }, [
    watched.fromAliasId,
    watched.to,
    watched.subject,
    watched.html,
    loading,
    submitting,
    deletingDraft,
  ])

  async function deleteCurrentDraft() {
    if (!draftId) return
    if (!window.confirm(t("compose.deleteDraftConfirm"))) return

    setDeletingDraft(true)
    skipAutoSaveRef.current = true
    try {
      await api(`/api/messages/drafts/${draftId}`, { method: "DELETE" })
      toast.success(t("compose.draftDeleted"))
      navigate("/draft")
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("compose.draftDeleteFailed"))
      skipAutoSaveRef.current = false
    } finally {
      setDeletingDraft(false)
    }
  }

  async function onSubmit(values: ComposeValues) {
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

    const to = parseRecipients(parsed.data.to)
    const text = htmlToText(parsed.data.html)

    skipAutoSaveRef.current = true
    setSubmitting(true)
    try {
      await api("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({
          fromAliasId: parsed.data.fromAliasId,
          to,
          subject: parsed.data.subject,
          text,
          html: parsed.data.html,
          replyToMessageId,
          draftId: draftIdRef.current,
        }),
      })
      toast.success(t("compose.sent"))
      navigate("/sent")
    } catch (err) {
      skipAutoSaveRef.current = false
      if (isApiError(err)) {
        const code = err.body.error as SendErrorCode | undefined
        toast.error(
          (code && t(`compose.errors.${code}`)) || err.message || t("compose.sendFailed")
        )
      } else {
        toast.error(t("compose.sendFailed"))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        {t("app.loading")}
      </div>
    )
  }

  if (aliases.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <PageHeader title={t("compose.title")} />
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-4 py-6 sm:px-6">
            <p className="text-sm text-muted-foreground">{t("compose.needAlias")}</p>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => navigate("/aliases")}
            >
              {t("compose.manageAliases")}
            </Button>
          </div>
        </ScrollArea>
      </div>
    )
  }

  const autoSaveLabel =
    autoSaveStatus === "saving"
      ? t("compose.autoSaving")
      : autoSaveStatus === "saved"
        ? t("compose.autoSaved")
        : autoSaveStatus === "error"
          ? t("compose.autoSaveFailed")
          : null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={title}
        actions={
          autoSaveLabel ? (
            <span
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
          className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.fromAliasId || undefined}>
              <FieldLabel htmlFor="compose-from">{t("compose.from")}</FieldLabel>
              <Controller
                control={form.control}
                name="fromAliasId"
                render={({ field }) => (
                  <Select
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
              <FieldLabel htmlFor="compose-subject">{t("compose.subject")}</FieldLabel>
              <Input id="compose-subject" {...form.register("subject")} />
            </Field>

            <Field data-invalid={!!form.formState.errors.html || undefined}>
              <FieldLabel htmlFor="compose-editor">{t("compose.body")}</FieldLabel>
              <Controller
                control={form.control}
                name="html"
                render={({ field }) => (
                  <RichTextEditor
                    key={editorKey}
                    id="compose-editor"
                    value={field.value}
                    onChange={field.onChange}
                    invalid={!!form.formState.errors.html}
                  />
                )}
              />
              <FieldError errors={[form.formState.errors.html]} />
            </Field>
          </FieldGroup>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={submitting || savingDraft || deletingDraft}>
              <PaperPlaneTiltIcon data-icon="inline-start" />
              {submitting ? t("compose.sending") : t("compose.send")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting || savingDraft || deletingDraft}
              onClick={() => void saveDraft()}
            >
              <FloppyDiskIcon data-icon="inline-start" />
              {savingDraft ? t("compose.savingDraft") : t("compose.saveDraft")}
            </Button>
            {draftId ? (
              <Button
                type="button"
                variant="outline"
                disabled={submitting || savingDraft || deletingDraft}
                onClick={() => void deleteCurrentDraft()}
              >
                <TrashIcon data-icon="inline-start" />
                {deletingDraft ? t("compose.deletingDraft") : t("compose.deleteDraft")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(-1)}
            >
              {t("app.cancel")}
            </Button>
          </div>
        </form>
      </ScrollArea>
    </div>
  )
}
