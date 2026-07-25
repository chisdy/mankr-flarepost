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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api, isApiError } from "@/lib/api"
import type { AuthUser } from "@/lib/types"

const setupSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  displayName: z.string().trim().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

type SetupValues = z.infer<typeof setupSchema>

export function SetupForm() {
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)

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
      toast.success("Admin account created")
      navigate("/inbox", { replace: true })
    } catch (err) {
      const message = isApiError(err)
        ? err.message || "Setup failed"
        : "Setup failed"
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Initial setup</CardTitle>
          <CardDescription>
            Create the single admin account. Only works when no users exist yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="setup-form" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.username || undefined}>
                <FieldLabel htmlFor="setup-username">Username</FieldLabel>
                <Input
                  id="setup-username"
                  autoComplete="username"
                  aria-invalid={!!form.formState.errors.username}
                  {...form.register("username")}
                />
                <FieldError errors={[form.formState.errors.username]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="setup-display-name">Display name</FieldLabel>
                <Input
                  id="setup-display-name"
                  autoComplete="name"
                  placeholder="Optional"
                  {...form.register("displayName")}
                />
                <FieldDescription>Shown in the app menu.</FieldDescription>
              </Field>
              <Field data-invalid={!!form.formState.errors.password || undefined}>
                <FieldLabel htmlFor="setup-password">Password</FieldLabel>
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
            {submitting ? "Creating…" : "Create admin"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already set up?{" "}
            <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
