import DOMPurify from "dompurify"

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html)
}
