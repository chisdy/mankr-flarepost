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

export type Tag = {
  id: string
  name: string
  color: string | null
  createdAt?: number
}

export type FilterCondition =
  | { type: "from_contains"; value: string }
  | { type: "to_alias_id"; value: string }
  | { type: "subject_contains"; value: string }
  | { type: "body_contains"; value: string }

export type FilterActions = {
  addTagIds?: string[]
  setStarred?: true
  moveToTrash?: true
}

export type FilterRule = {
  id: string
  name: string
  enabled: boolean
  priority: number
  matchMode: "and" | "or"
  conditions: FilterCondition[]
  actions: FilterActions
  createdAt: number
}

export type MessageListItem = {
  id: string
  folder: Folder
  fromAddr: string
  toAddrs: string[]
  subject: string
  isRead: boolean
  isStarred: boolean
  hasUnsupportedAttachments: boolean
  createdAt: number
  tagIds?: string[]
}

export type MessageDetail = MessageListItem & {
  textBody: string
  htmlBody: string | null
  aliasId: string
  direction: "inbound" | "outbound"
  lastErrorCode: string | null
  tags: Tag[]
}

export type MailboxViewMode =
  | { kind: "folder"; folder: Folder }
  | { kind: "starred" }
  | { kind: "tag"; tagId: string }

export type SendErrorCode =
  | "not_configured"
  | "rate_limited"
  | "invalid_address"
  | "provider_error"

export type ApiErrorBody = {
  error?: string
  message?: string
}
