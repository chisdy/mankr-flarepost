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

export type Folder = "inbox" | "sent" | "trash" | "draft" | "spam"

export type FolderCounts = {
  inbox: number
  sent: number
  trash: number
  draft: number
  spam: number
  starred: number
}

export type MailboxSettings = {
  trashRetentionDays: number
  spamRetentionDays: number
}

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
  moveToSpam?: true
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
  | { kind: "search"; query: string }

export type SendErrorCode =
  | "not_configured"
  | "rate_limited"
  | "invalid_address"
  | "provider_error"

export type ApiErrorBody = {
  error?: string
  message?: string
}

export type ApiKeyUsage = {
  sent24h: number
  failed24h: number
  sent7d: number
  failed7d: number
  lastUsedAt: number | null
}

export type ApiKey = {
  id: string
  name: string
  keyPrefix: string
  aliasId: string
  aliasAddress: string
  aliasEnabled: boolean
  enabled: boolean
  hourlyLimit: number
  dailyLimit: number
  createdAt: number
  usage: ApiKeyUsage
  /** Present only on the create response — shown once, never stored. */
  secret?: string
}

export type QuotaWindow = "day" | "month" | "total"

export type ProviderStatus = "ok" | "not_configured" | "error"

/** `limit` is the free-plan allowance, not the account's contractual ceiling. */
export type Quota = {
  used: number
  limit: number
  remaining: number
  window: QuotaWindow
}

export type CloudflareErrorReason =
  | "unauthorized"
  | "query_failed"
  | "unreachable"

export type SendProviderId = "resend"

/** A `null` window means the provider caps nothing there, not that the cap is zero. */
export type SendProviderLimits = {
  emailsPerDay: number | null
  emailsPerMonth: number | null
}

/**
 * Send quotas come from two sources that can each see what the other cannot: `reported` is
 * the provider's own tally as of the last send it accepted, `observed` is what this app
 * recorded itself. `daily`/`monthly` already reconcile the two.
 */
export type SendProviderUsage = {
  provider: SendProviderId
  status: ProviderStatus
  limits: SendProviderLimits
  daily: Quota | null
  monthly: Quota | null
  reported: {
    dailyUsed: number | null
    monthlyUsed: number | null
    capturedAt: string
  } | null
  observed: {
    daily: number
    monthly: number
  }
}

/** Sent by the worker so these allowances are defined in exactly one place. */
export type FreeTierLimits = {
  workersRequestsPerDay: number
  d1RowsReadPerDay: number
  d1RowsWrittenPerDay: number
  d1StorageBytes: number
}

/** A `null` metric means the provider did not report it, not that it is zero. */
export type UsageSnapshot = {
  fetchedAt: string
  freeTier: FreeTierLimits
  sendProviders: SendProviderUsage[]
  cloudflare: {
    status: ProviderStatus
    reason: CloudflareErrorReason | null
    workersRequests: Quota | null
    d1RowsRead: Quota | null
    d1RowsWritten: Quota | null
    d1StorageBytes: Quota | null
  }
}
