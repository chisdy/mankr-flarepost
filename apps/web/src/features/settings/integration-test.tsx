import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function IntegrationTest({ onSent }: { onSent: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState("")
  const [to, setTo] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState("")
  async function send() {
    if (!secret.trim() || !to.trim()) return
    setBusy(true)
    setResult("")
    try {
      const res = await fetch("/api/v1/send", {
        method: "POST",
        credentials: "omit",
        headers: {
          Authorization: `Bearer ${secret.trim()}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `test/${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          to: [to.trim()],
          subject: "Mankr Flarepost integration test",
          text: "Your project's HTTP email connection is working.",
        }),
      })
      const body = (await res.json()) as {
        id?: string
        error?: string
        state?: string
        requestId?: string
      }
      if (body.state === "unknown")
        setResult(
          `${t("integrations.unknownHint")} ID: ${body.requestId ?? ""}`
        )
      else if (res.ok)
        setResult(`${t("integrations.testAccepted")} ID: ${body.id ?? ""}`)
      else
        setResult(
          `${res.status}: ${body.error ?? t("integrations.testFailed")}`
        )
      onSent()
    } catch {
      setResult(t("integrations.unknownHint"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true)
          setResult("")
        }}
      >
        {t("integrations.test")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (busy) return
          setOpen(value)
          if (!value) {
            setSecret("")
            setTo("")
            setResult("")
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("integrations.test")}</DialogTitle>
            <DialogDescription>{t("integrations.testHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!result) void send()
            }}
          >
            <Field>
              <FieldLabel htmlFor="integration-test-key">
                {t("integrations.testKey")}
              </FieldLabel>
              <Input
                id="integration-test-key"
                type="password"
                autoComplete="off"
                value={secret}
                disabled={busy}
                onChange={(event) => setSecret(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="integration-test-to">
                {t("integrations.testRecipient")}
              </FieldLabel>
              <Input
                id="integration-test-to"
                type="email"
                value={to}
                disabled={busy}
                onChange={(event) => setTo(event.target.value)}
                required
              />
            </Field>
            {result ? (
              <p
                role="status"
                className="rounded-xl bg-muted/50 p-3 text-sm break-all"
              >
                {result}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="submit"
                disabled={busy || !!result || !to || !secret}
              >
                {busy ? t("app.loading") : t("integrations.sendTest")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
