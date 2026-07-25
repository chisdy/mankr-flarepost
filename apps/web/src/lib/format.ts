import i18n from "@/i18n"

function localeTag(): string {
  const lng = i18n.resolvedLanguage ?? i18n.language
  return lng.startsWith("zh") ? "zh-CN" : lng || "en"
}

export function formatMessageTime(epochMs: number): string {
  const date = new Date(epochMs)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const locale = localeTag()

  if (sameDay) {
    return date.toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
    })
  }

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

export function formatFullTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(localeTag(), {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function replySubject(subject: string, noSubject: string): string {
  const trimmed = subject.trim() || noSubject
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

export function forwardSubject(subject: string, noSubject: string): string {
  const trimmed = subject.trim() || noSubject
  return /^fwd:\s/i.test(trimmed) ? trimmed : `Fwd: ${trimmed}`
}

export function quoteReplyBody(
  fromAddr: string,
  createdAt: number,
  textBody: string,
  quoteHeader: (when: string, from: string) => string
): string {
  const when = formatFullTime(createdAt)
  const quoted = textBody
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
  return `\n\n${quoteHeader(when, fromAddr)}\n${quoted}`
}

export function quoteForwardBody(
  fromAddr: string,
  toAddrs: string[],
  createdAt: number,
  subject: string,
  textBody: string,
  labels: { from: string; to: string; date: string; subject: string }
): string {
  const when = formatFullTime(createdAt)
  const header = [
    "---------- Forwarded message ----------",
    `${labels.from}: ${fromAddr}`,
    `${labels.date}: ${when}`,
    `${labels.subject}: ${subject}`,
    `${labels.to}: ${toAddrs.join(", ")}`,
  ].join("\n")
  return `\n\n${header}\n\n${textBody}`
}
