import { zodResolver } from "@hookform/resolvers/zod"
import { PaperPlaneTiltIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, isApiError } from "@/lib/api"
import { quoteReplyBody, replySubject } from "@/lib/format"
import type { Alias, MessageDetail, SendErrorCode } from "@/lib/types"
import { cn } from "@/lib/utils"

const composeSchema = z.object({
  fromAliasId: z.string().min(1, "Select a from alias"),
  to: z
    .string()
    .trim()
    .min(1, "At least one recipient is required")
    .refine(
      (value) =>
        value
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .every((addr) => addr.includes("@")),
      "Enter valid email addresses"
    ),
  subject: z.string(),
  text: z.string().min(1, "Message body is required"),
})

type ComposeValues = z.infer<typeof composeSchema>

const SEND_TOAST: Record<SendErrorCode, string> = {
  not_configured:
    "Send channel not configured. Use SEND_CHANNEL=resend for Total Free outbound.",
  rate_limited: "Send rate limit exceeded (30/hour).",
  invalid_address: "Invalid sender or recipient address.",
  provider_error: "Email provider failed to send.",
}

const selectClassName = cn(
  "h-8 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 py-1 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
)

export function ComposeView() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const replyId = params.get("reply")

  const [aliases, setAliases] = useState<Alias[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [replyToMessageId, setReplyToMessageId] = useState<string | undefined>()

  const form = useForm<ComposeValues>({
    resolver: zodResolver(composeSchema),
    defaultValues: {
      fromAliasId: "",
      to: "",
      subject: "",
      text: "",
    },
  })

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

        if (replyId) {
          const original = await api<MessageDetail>(`/api/messages/${replyId}`)
          if (cancelled) return
          const replyAlias =
            enabled.find((a) => a.id === original.aliasId) ?? defaultAlias
          defaults = {
            fromAliasId: replyAlias?.id ?? "",
            to: original.fromAddr,
            subject: replySubject(original.subject),
            text: quoteReplyBody(
              original.fromAddr,
              original.createdAt,
              original.textBody
            ),
          }
          setReplyToMessageId(original.id)
        }

        form.reset(defaults)
      } catch (err) {
        toast.error(isApiError(err) ? err.message : "Failed to load compose data")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [replyId, form])

  async function onSubmit(values: ComposeValues) {
    const to = values.to
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    setSubmitting(true)
    try {
      await api("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({
          fromAliasId: values.fromAliasId,
          to,
          subject: values.subject,
          text: values.text,
          replyToMessageId,
        }),
      })
      toast.success("Message sent")
      navigate("/sent")
    } catch (err) {
      if (isApiError(err)) {
        const code = err.body.error as SendErrorCode | undefined
        toast.error(
          (code && SEND_TOAST[code]) || err.message || "Send failed"
        )
      } else {
        toast.error("Send failed")
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (aliases.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h1 className="font-heading text-lg font-medium">Compose</h1>
        <p className="text-sm text-muted-foreground">
          Create an enabled alias before sending mail.
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => navigate("/aliases")}
        >
          Manage aliases
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="font-heading text-lg font-medium">
          {replyId ? "Reply" : "Compose"}
        </h1>
      </header>

      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-6"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.fromAliasId || undefined}>
            <FieldLabel htmlFor="compose-from">From</FieldLabel>
            <Controller
              control={form.control}
              name="fromAliasId"
              render={({ field }) => (
                <select
                  id="compose-from"
                  className={selectClassName}
                  aria-invalid={!!form.formState.errors.fromAliasId}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                >
                  {aliases.map((alias) => (
                    <option key={alias.id} value={alias.id}>
                      {alias.address}
                      {alias.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              )}
            />
            <FieldError errors={[form.formState.errors.fromAliasId]} />
          </Field>

          <Field data-invalid={!!form.formState.errors.to || undefined}>
            <FieldLabel htmlFor="compose-to">To</FieldLabel>
            <Input
              id="compose-to"
              placeholder="recipient@example.com"
              autoComplete="email"
              aria-invalid={!!form.formState.errors.to}
              {...form.register("to")}
            />
            <FieldDescription>
              Separate multiple addresses with commas.
            </FieldDescription>
            <FieldError errors={[form.formState.errors.to]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="compose-subject">Subject</FieldLabel>
            <Input id="compose-subject" {...form.register("subject")} />
          </Field>

          <Field data-invalid={!!form.formState.errors.text || undefined}>
            <FieldLabel htmlFor="compose-text">Message</FieldLabel>
            <Textarea
              id="compose-text"
              className="min-h-48"
              aria-invalid={!!form.formState.errors.text}
              {...form.register("text")}
            />
            <FieldError errors={[form.formState.errors.text]} />
          </Field>
        </FieldGroup>

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            <PaperPlaneTiltIcon data-icon="inline-start" />
            {submitting ? "Sending…" : "Send"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
