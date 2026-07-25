import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { useAuth } from "@/components/auth-gate"
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

const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginForm() {
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)

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
        ? err.message || "Invalid credentials"
        : "Login failed"
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Sign in to your Mankr Mail inbox.</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="login-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.username || undefined}>
                <FieldLabel htmlFor="login-username">Username</FieldLabel>
                <Input
                  id="login-username"
                  autoComplete="username"
                  aria-invalid={!!form.formState.errors.username}
                  {...form.register("username")}
                />
                <FieldError errors={[form.formState.errors.username]} />
              </Field>
              <Field data-invalid={!!form.formState.errors.password || undefined}>
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
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
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            First time?{" "}
            <Link to="/setup" className="text-foreground underline-offset-4 hover:underline">
              Create admin
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
