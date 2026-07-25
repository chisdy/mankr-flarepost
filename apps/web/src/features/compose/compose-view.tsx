import { zodResolver } from "@hookform/resolvers/zod"
import { FloppyDiskIcon, PaperPlaneTiltIcon, TrashIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"
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
import { Textarea } from "@/components/ui/textarea"
import { api, isApiError } from "@/lib/api"
import {
  forwardSubject,
  quoteForwardBody,
  quoteReplyBody,
  replySubject,
} from "@/lib/format"
import type { Alias, MessageDetail, SendErrorCode } from "@/lib/types"

type ComposeValues = {
  fromAliasId: string
  to: string
  subject: string
  text: string
}

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
        text: z.string(),
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
        text: z.string().min(1, t("compose.bodyRequired")),
      }),
    [composeSchema, t]
  )

  const form = useForm<ComposeValues>({
    resolver: zodResolver(composeSchema),
    defaultValues: {
      fromAliasId: "",
      to: "",
      subject: "",
      text: "",
    },
  })

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
          text: "",
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
            text: original.textBody,
          }
          setDraftId(original.id)
        } else if (replyId) {
          const original = await api<MessageDetail>(`/api/messages/${replyId}`)
          if (cancelled) return
          const replyAlias =
            enabled.find((a) => a.id === original.aliasId) ?? defaultAlias
          defaults = {
            fromAliasId: replyAlias?.id ?? "",
            to: original.fromAddr,
            subject: replySubject(original.subject, t("app.noSubject")),
            text: quoteReplyBody(
              original.fromAddr,
              original.createdAt,
              original.textBody,
              (when, from) => t("compose.quoteHeader", { when, from })
            ),
          }
          setReplyToMessageId(original.id)
        } else if (forwardId) {
          const original = await api<MessageDetail>(`/api/messages/${forwardId}`)
          if (cancelled) return
          const forwardAlias =
            enabled.find((a) => a.id === original.aliasId) ?? defaultAlias
          defaults = {
            fromAliasId: forwardAlias?.id ?? "",
            to: "",
            subject: forwardSubject(original.subject, t("app.noSubject")),
            text: quoteForwardBody(
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
            ),
          }
        }

        form.reset(defaults)
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

  async function saveDraft() {
    const values = form.getValues()
    if (!values.fromAliasId) {
      toast.error(t("compose.selectFrom"))
      return
    }

    setSavingDraft(true)
    try {
      const payload = {
        fromAliasId: values.fromAliasId,
        to: parseRecipients(values.to),
        subject: values.subject,
        text: values.text,
      }
      if (draftId) {
        await api(`/api/messages/drafts/${draftId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
        toast.success(t("compose.draftSaved"))
      } else {
        const result = await api<{ id: string }>("/api/messages/drafts", {
          method: "POST",
          body: JSON.stringify(payload),
        })
        setDraftId(result.id)
        toast.success(t("compose.draftSaved"))
        navigate(`/compose?draft=${result.id}`, { replace: true })
      }
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("compose.draftSaveFailed"))
    } finally {
      setSavingDraft(false)
    }
  }

  async function deleteCurrentDraft() {
    if (!draftId) return
    if (!window.confirm(t("compose.deleteDraftConfirm"))) return

    setDeletingDraft(true)
    try {
      await api(`/api/messages/drafts/${draftId}`, { method: "DELETE" })
      toast.success(t("compose.draftDeleted"))
      navigate("/draft")
    } catch (err) {
      toast.error(isApiError(err) ? err.message : t("compose.draftDeleteFailed"))
    } finally {
      setDeletingDraft(false)
    }
  }

  async function onSubmit(values: ComposeValues) {
    const parsed = sendSchema.safeParse(values)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (field === "to" || field === "text" || field === "fromAliasId") {
          form.setError(field, { message: issue.message })
        }
      }
      return
    }

    const to = parseRecipients(parsed.data.to)

    setSubmitting(true)
    try {
      await api("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({
          fromAliasId: parsed.data.fromAliasId,
          to,
          subject: parsed.data.subject,
          text: parsed.data.text,
          replyToMessageId,
          draftId,
        }),
      })
      toast.success(t("compose.sent"))
      navigate("/sent")
    } catch (err) {
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title={title} />

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

            <Field data-invalid={!!form.formState.errors.text || undefined}>
              <FieldLabel htmlFor="compose-text">{t("compose.body")}</FieldLabel>
              <Textarea
                id="compose-text"
                className="min-h-48"
                aria-invalid={!!form.formState.errors.text}
                {...form.register("text")}
              />
              <FieldError errors={[form.formState.errors.text]} />
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
