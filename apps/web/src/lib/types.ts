export type AuthUser = {
  username: string
  displayName: string | null
}

export type SetupStatus = {
  initialized: boolean
}

export type Alias = {
  id: string
  address: string
  enabled: boolean
  isDefault: boolean
  createdAt: number
}

export type Folder = "inbox" | "sent" | "trash" | "draft"

export type MessageListItem = {
  id: string
  folder: Folder
  fromAddr: string
  toAddrs: string[]
  subject: string
  isRead: boolean
  hasUnsupportedAttachments: boolean
  createdAt: number
}

export type MessageDetail = MessageListItem & {
  textBody: string
  htmlBody: string | null
  aliasId: string
  direction: "inbound" | "outbound"
  lastErrorCode: string | null
}

export type SendErrorCode =
  | "not_configured"
  | "rate_limited"
  | "invalid_address"
  | "provider_error"

export type ApiErrorBody = {
  error?: string
  message?: string
}
