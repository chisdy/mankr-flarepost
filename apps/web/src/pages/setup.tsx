import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function SetupPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Setup</CardTitle>
          <CardDescription>
            Bootstrap the first admin when no users exist yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Placeholder — POST /api/setup
        </CardContent>
      </Card>
    </div>
  )
}
