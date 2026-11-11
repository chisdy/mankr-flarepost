import PostalMime from 'postal-mime'

export type ParsedInbound = {
  fromAddr: string
  replyToAddrs: string[]
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
  const replyToAddrs = [...new Set(
    (email.replyTo ?? [])
      .flatMap((address) => address.group ?? [address])
      .map((address) => address.address?.trim() ?? '')
      .filter((address) =>
        address.length <= 254 && /^[^\s<>@,;\x00-\x1f\x7f]+@[^\s<>@,;\x00-\x1f\x7f]+$/.test(address)),
  )]

  return {
    fromAddr,
    replyToAddrs,
    subject: email.subject ?? '',
    textBody: email.text ?? '',
    htmlBody: email.html ?? null,
    hasAttachments: (email.attachments ?? []).length > 0,
  }
}
