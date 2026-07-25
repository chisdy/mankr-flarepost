import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
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

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

type PasswordValues = z.infer<typeof passwordSchema>

type ChangePasswordDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: ChangePasswordDialogProps) {
  const [submitting, setSubmitting] = useState(false)
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
      toast.success("Password updated")
      form.reset()
      onOpenChange(false)
    } catch (err) {
      const message = isApiError(err)
        ? err.message || "Could not update password"
        : "Could not update password"
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
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Choose a new password with at least 8 characters.
          </DialogDescription>
        </DialogHeader>
        <form id="change-password-form" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field
              data-invalid={!!form.formState.errors.currentPassword || undefined}
            >
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
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
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
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
              <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
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
            Cancel
          </Button>
          <Button type="submit" form="change-password-form" disabled={submitting}>
            {submitting ? "Saving…" : "Update password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
