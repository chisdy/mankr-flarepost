import PostalMime from 'postal-mime'

export type ParsedInbound = {
  fromAddr: string
  subject: string
  textBody: string
  htmlBody: string | null
  hasUnsupportedAttachments: boolean
}

function mailboxAddress(addr: unknown): string | null {
  if (!addr || typeof addr !== 'object') return null
  if ('address' in addr && typeof (addr as { address?: unknown }).address === 'string') {
    return (addr as { address: string }).address
  }
  return null
}

/** Parse raw MIME bytes into inbox fields (postal-mime). */
export async function parseInboundMime(raw: ArrayBuffer | Uint8Array): Promise<ParsedInbound> {
  const email = await PostalMime.parse(raw)
  const fromAddr = mailboxAddress(email.from) ?? mailboxAddress(email.sender) ?? ''
  const attachments = email.attachments ?? []
  const hasUnsupportedAttachments = attachments.length > 0

  return {
    fromAddr,
    subject: email.subject ?? '',
    textBody: email.text ?? '',
    htmlBody: email.html ?? null,
    hasUnsupportedAttachments,
  }
}
