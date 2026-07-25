import { Badge } from "@/components/ui/badge"

export function AliasesPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-lg font-medium">Aliases</h1>
        <Badge variant="secondary">Placeholder</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Alias management UI arrives in Task 8. Hard cap: 5.
      </p>
    </div>
  )
}
