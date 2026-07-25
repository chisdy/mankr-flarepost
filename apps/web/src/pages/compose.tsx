import { useSearchParams } from "react-router"

import { Badge } from "@/components/ui/badge"

export function ComposePage() {
  const [params] = useSearchParams()
  const reply = params.get("reply")

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-lg font-medium">Compose</h1>
        <Badge variant="secondary">Placeholder</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Compose UI arrives in Task 8.
        {reply ? ` Reply to: ${reply}` : null}
      </p>
    </div>
  )
}
