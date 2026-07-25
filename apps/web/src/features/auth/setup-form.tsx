import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Link, Navigate, useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { useAuth } from "@/components/auth-gate"
import { LanguageSwitcher } from "@/components/language-switcher"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api, isApiError } from "@/lib/api"
import type { AuthUser, SetupStatus } from "@/lib/types"

type SetupValues = {
  username: string
  displayName?: string
  password: string
}

export function SetupForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [initialized, setInitialized] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    api<SetupStatus>("/api/setup")
      .then((status) => {
        if (!cancelled) setInitialized(status.initialized)
      })
      .catch(() => {
        // Fail closed: if status cannot be loaded, send user to login.
        if (!cancelled) setInitialized(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setupSchema = useMemo(
    () =>
      z.object({
        username: z.string().trim().min(1, t("auth.usernameRequired")),
        displayName: z.string().trim().optional(),
        password: z.string().min(8, t("auth.passwordMin")),
      }),
    [t]
  )

  const form = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { username: "", displayName: "", password: "" },
  })

  async function onSubmit(values: SetupValues) {
    setSubmitting(true)
    try {
      const user = await api<AuthUser>("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          username: values.username,
          password: values.password,
          displayName: values.displayName || undefined,
        }),
      })
      setUser(user)
      toast.success(t("auth.adminCreated"))
      navigate("/inbox", { replace: true })
    } catch (err) {
      const message = isApiError(err)
        ? err.message || t("auth.setupFailed")
        : t("auth.setupFailed")
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (initialized === null) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        {t("app.loading")}
      </div>
    )
  }

  if (initialized) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher className="w-36" />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("auth.setupTitle")}</CardTitle>
          <CardDescription>{t("auth.setupDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="setup-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.username || undefined}>
                <FieldLabel htmlFor="setup-username">{t("auth.username")}</FieldLabel>
                <Input
                  id="setup-username"
                  autoComplete="username"
                  aria-invalid={!!form.formState.errors.username}
                  {...form.register("username")}
                />
                <FieldError errors={[form.formState.errors.username]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="setup-display-name">{t("auth.displayName")}</FieldLabel>
                <Input
                  id="setup-display-name"
                  autoComplete="name"
                  placeholder={t("auth.optional")}
                  {...form.register("displayName")}
                />
                <FieldDescription>{t("auth.displayNameHint")}</FieldDescription>
              </Field>
              <Field data-invalid={!!form.formState.errors.password || undefined}>
                <FieldLabel htmlFor="setup-password">{t("auth.password")}</FieldLabel>
                <Input
                  id="setup-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!form.formState.errors.password}
                  {...form.register("password")}
                />
                <FieldError errors={[form.formState.errors.password]} />
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button type="submit" form="setup-form" disabled={submitting}>
            {submitting ? t("auth.creating") : t("auth.createAdmin")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("auth.alreadySetup")}{" "}
            <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
              {t("auth.signIn")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
