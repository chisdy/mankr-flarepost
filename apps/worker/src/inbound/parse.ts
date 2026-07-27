import PostalMime from 'postal-mime'

export type ParsedInbound = {
  fromAddr: string
  subject: string
  textBody: string
  htmlBody: string | null
  /** Attachment bytes are never stored (no R2); this only drives the UI banner. */
  hasAttachments: boolean
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

  return {
    fromAddr,
    subject: email.subject ?? '',
    textBody: email.text ?? '',
    htmlBody: email.html ?? null,
    hasAttachments: (email.attachments ?? []).length > 0,
  }
}
