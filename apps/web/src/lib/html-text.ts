/** Escape text for safe HTML insertion. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Convert plain text (e.g. reply quotes) into simple HTML paragraphs. */
export function textToHtml(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n")
  if (!trimmed.trim()) return ""
  return trimmed
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((line) => escapeHtml(line)).join("<br>")
      return `<p>${lines || "<br>"}</p>`
    })
    .join("")
}

/** Rough HTML → plain text for send/draft text_body fallback. */
export function htmlToText(html: string): string {
  if (!html.trim()) return ""
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
  const stripped = withBreaks.replace(/<[^>]+>/g, "")
  return stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** True when HTML has meaningful visible text. */
export function htmlHasText(html: string): boolean {
  return htmlToText(html).length > 0
}
