export function formatMessageTime(epochMs: number): string {
  const date = new Date(epochMs)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })
  }

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

export function formatFullTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim() || "(no subject)"
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

export function quoteReplyBody(fromAddr: string, createdAt: number, textBody: string): string {
  const when = formatFullTime(createdAt)
  const quoted = textBody
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
  return `\n\nOn ${when}, ${fromAddr} wrote:\n${quoted}`
}
