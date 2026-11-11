---
version: 1
slug: "src-features-mailbox-mailbox-view-tsx"
primary_target: "src/features/mailbox/mailbox-view.tsx"
related_targets: ["src/components/app-shell.tsx","src/features/message/message-view.tsx","src/features/compose/compose-view.tsx","src/features/settings/settings-view.tsx","src/features/usage/usage-view.tsx"]
---

## Scope

Mode: Operate. Authenticated mailbox and its companion screens. Desktop and mobile have equal priority.

## Direction contract

**Thesis:** 折页信笺 makes mail feel like an orderly working sheet, with a distinct navigation rail and a quiet reading field.

**Own world:** Near-white paper and a charcoal rail with a trace of violet in light mode; neutral graphite surfaces in dark mode. Muted violet carries primary actions and focus; gray fills and whitespace separate content. Keep the existing folded Flarepost mark and use familiar controls.

**First viewport:** Desktop shows the folder rail and aligned sender, subject and time. Mobile puts the same mail in two lines with search and compose in reach. Setup guidance starts collapsed when mail exists.

**Signature:** A tonal fill and stronger text signal unread mail without moving the row.

**Reach:** Keep the same tonal split in authentication and settings. Give reading an independent scroll area and return to its source list.

**Form:** Fold direction; code-led; seed `1fc101f7`. There is no selected image comp.

## Message reader

Let the subject lead a single reading sheet. Keep the sender, first recipient, time, and tags in the envelope above the reading rule; disclose additional recipients on demand. Place back, star, and the management menu in the top strip. Keep the applicable primary action and optional forward button below the scroll area. Use the same order at every width, wrap long content in place, and preserve the source mailbox when returning.

Use the workspace width for the sheet and its controls. Only plain-text paragraphs need a reading measure; give HTML layouts the full reading area and contain any overflow there.
