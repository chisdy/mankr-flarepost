import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const LANGUAGES = [".env", "curl", "Node.js", "Python", "PHP"] as const
type Language = (typeof LANGUAGES)[number]

function integrationExample(language: Language, endpoint: string): string {
  switch (language) {
    case ".env":
      return `MANKR_MAIL_API_URL=${endpoint}\nMANKR_MAIL_API_KEY=replace_with_your_project_key`
    case "curl":
      return `curl "$MANKR_MAIL_API_URL" \\\n  -H "Authorization: Bearer $MANKR_MAIL_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: order-123-confirmation" \\\n  -d '{"to":["recipient@example.com"],"subject":"Hello","text":"Hello from my project"}'`
    case "Node.js":
      return `// Run on your server. Reuse the event ID when retrying.\nconst response = await fetch(process.env.MANKR_MAIL_API_URL, {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${process.env.MANKR_MAIL_API_KEY}\`,\n    "Content-Type": "application/json",\n    "Idempotency-Key": "order-123-confirmation",\n  },\n  body: JSON.stringify({\n    to: ["recipient@example.com"], subject: "Hello", text: "Hello from my project",\n  }),\n});\nconst result = await response.json();\nif (!response.ok) throw new Error(JSON.stringify(result));\nconsole.log(result.id);`
    case "Python":
      return `import os\nimport requests\n\nresponse = requests.post(os.environ["MANKR_MAIL_API_URL"],\n    headers={\n        "Authorization": "Bearer " + os.environ["MANKR_MAIL_API_KEY"],\n        "Idempotency-Key": "order-123-confirmation",\n    },\n    json={"to": ["recipient@example.com"], "subject": "Hello", "text": "Hello from my project"},\n    timeout=45,\n)\nprint(response.status_code, response.json())`
    case "PHP":
      return `<?php\n$ch = curl_init(getenv('MANKR_MAIL_API_URL'));\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true,\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_TIMEOUT => 45,\n  CURLOPT_HTTPHEADER => [\n    'Authorization: Bearer ' . getenv('MANKR_MAIL_API_KEY'),\n    'Content-Type: application/json',\n    'Idempotency-Key: order-123-confirmation',\n  ],\n  CURLOPT_POSTFIELDS => json_encode([\n    'to' => ['recipient@example.com'], 'subject' => 'Hello', 'text' => 'Hello from my project',\n  ]),\n]);\n$result = curl_exec($ch);\nif ($result === false) throw new RuntimeException(curl_error($ch));\necho curl_getinfo($ch, CURLINFO_HTTP_CODE) . " " . $result;\ncurl_close($ch);`
  }
}

export function IntegrationExamples() {
  const { t } = useTranslation()
  const [language, setLanguage] = useState<Language>(".env")
  const endpoint = `${window.location.origin}/api/v1/send`
  const example = integrationExample(language, endpoint)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("integrations.examples")}</CardTitle>
        <CardDescription>{t("integrations.serverOnly")}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <p className="font-mono text-xs break-all">POST {endpoint}</p>
        <div
          className="flex flex-wrap gap-2"
          aria-label={t("integrations.exampleLanguage")}
        >
          {LANGUAGES.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={language === item ? "secondary" : "ghost"}
              aria-pressed={language === item}
              onClick={() => setLanguage(item)}
            >
              {item}
            </Button>
          ))}
        </div>
        <pre className="max-h-80 overflow-auto rounded-xl bg-muted/50 p-4 text-xs">
          <code>{example}</code>
        </pre>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(example)
              .then(() => toast.success(t("apiKeys.copied")))
              .catch(() => toast.error(t("apiKeys.copyFailed")))
          }
        >
          {t("integrations.copyExample")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("integrations.retryHint")}
        </p>
      </CardContent>
    </Card>
  )
}
