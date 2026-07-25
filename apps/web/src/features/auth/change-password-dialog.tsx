import { zodResolver } from "@hookform/resolvers/zod"
import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api, isApiError } from "@/lib/api"

type PasswordValues = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

type ChangePasswordDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: ChangePasswordDialogProps) {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)

  const passwordSchema = useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(1, t("auth.currentPasswordRequired")),
          newPassword: z.string().min(8, t("auth.newPasswordMin")),
          confirmPassword: z.string().min(1, t("auth.confirmRequired")),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: t("auth.passwordsMismatch"),
          path: ["confirmPassword"],
        }),
    [t]
  )

  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  })

  async function onSubmit(values: PasswordValues) {
    setSubmitting(true)
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      })
      toast.success(t("auth.passwordUpdated"))
      form.reset()
      onOpenChange(false)
    } catch (err) {
      const message = isApiError(err)
        ? err.message || t("auth.passwordUpdateFailed")
        : t("auth.passwordUpdateFailed")
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("auth.changePasswordTitle")}</DialogTitle>
          <DialogDescription>
            {t("auth.changePasswordDescription")}
          </DialogDescription>
        </DialogHeader>
        <form id="change-password-form" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field
              data-invalid={!!form.formState.errors.currentPassword || undefined}
            >
              <FieldLabel htmlFor="current-password">{t("auth.currentPassword")}</FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!form.formState.errors.currentPassword}
                {...form.register("currentPassword")}
              />
              <FieldError errors={[form.formState.errors.currentPassword]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.newPassword || undefined}>
              <FieldLabel htmlFor="new-password">{t("auth.newPassword")}</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!form.formState.errors.newPassword}
                {...form.register("newPassword")}
              />
              <FieldError errors={[form.formState.errors.newPassword]} />
            </Field>
            <Field
              data-invalid={!!form.formState.errors.confirmPassword || undefined}
            >
              <FieldLabel htmlFor="confirm-password">{t("auth.confirmPassword")}</FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!form.formState.errors.confirmPassword}
                {...form.register("confirmPassword")}
              />
              <FieldError errors={[form.formState.errors.confirmPassword]} />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("app.cancel")}
          </Button>
          <Button type="submit" form="change-password-form" disabled={submitting}>
            {submitting ? t("auth.saving") : t("auth.updatePassword")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
