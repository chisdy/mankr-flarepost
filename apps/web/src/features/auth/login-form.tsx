import { zodResolver } from "@hookform/resolvers/zod"
import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api, isApiError } from "@/lib/api"
import type { AuthUser } from "@/lib/types"

type LoginValues = {
  username: string
  password: string
}

export function LoginForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)

  const loginSchema = useMemo(
    () =>
      z.object({
        username: z.string().trim().min(1, t("auth.usernameRequired")),
        password: z.string().min(1, t("auth.passwordRequired")),
      }),
    [t]
  )

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  })

  async function onSubmit(values: LoginValues) {
    setSubmitting(true)
    try {
      const user = await api<AuthUser>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      })
      setUser(user)
      navigate("/inbox", { replace: true })
    } catch (err) {
      const message = isApiError(err)
        ? err.message || t("auth.invalidCredentials")
        : t("auth.loginFailed")
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher className="w-36" />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("auth.signInTitle")}</CardTitle>
          <CardDescription>{t("auth.signInDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="login-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.username || undefined}>
                <FieldLabel htmlFor="login-username">{t("auth.username")}</FieldLabel>
                <Input
                  id="login-username"
                  autoComplete="username"
                  aria-invalid={!!form.formState.errors.username}
                  {...form.register("username")}
                />
                <FieldError errors={[form.formState.errors.username]} />
              </Field>
              <Field data-invalid={!!form.formState.errors.password || undefined}>
                <FieldLabel htmlFor="login-password">{t("auth.password")}</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!form.formState.errors.password}
                  {...form.register("password")}
                />
                <FieldError errors={[form.formState.errors.password]} />
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button type="submit" form="login-form" disabled={submitting}>
            {submitting ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("auth.firstTime")}{" "}
            <Link to="/setup" className="text-foreground underline-offset-4 hover:underline">
              {t("auth.createAdmin")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
