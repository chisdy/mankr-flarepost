# Design: Stars, Tags, and Inbound Filters (Phase 1)

| Item | Content |
|------|---------|
| Date | 2026-07-26 |
| Status | Confirmed |
| Scope | Stars, tags, inbound filters only |

## Decisions

- No custom folders in this phase (tags are multi-select; stars are `messages.is_starred`).
- Filters run only on new inbound mail; no replay on existing messages.
- Filter match: conditions `from_contains` / `to_alias_id` / `subject_contains` / `body_contains` (`text_body`, case-insensitive); `match_mode` AND|OR; `enabled`; `priority` ascending.
- All matching filters execute and stack actions. `moveToTrash` does not stop later rules.
- Trash via filter matches manual trash: set `folder='trash'` and `deleted_at`.
- Tag hard limit: 50. Missing tag IDs at apply time are skipped (inbound must not fail).
- List views: `starred=1` or `tagId=` exclude `trash` and `draft`; mutually exclusive.
- Storage: normalized tables `tags`, `message_tags`, `filters` (not JSON-on-message for tags).

## Out of scope

Custom folders, attachments, search, auto-save drafts, rich-text compose, filter replay.

## Later phases

2. Search + auto-save drafts + rich-text compose  
3. Attachments (R2)  
