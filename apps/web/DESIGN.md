---
name: Mankr Flarepost
description: A charcoal-violet fold and a quiet working sheet for domain email.
colors:
  background: "#f4f5f6"
  foreground: "#24272c"
  card: "#fff"
  popover: "#fff"
  primary: "#584681"
  primary-foreground: "#fff"
  secondary: "#edf0f2"
  muted: "#f0f2f4"
  accent: "#e6e9ed"
  accent-foreground: "#24272c"
  muted-foreground: "#565d66"
  border: "#e1e4e8"
  input: "#858d98"
  ring: "#7356b8"
  main: "#f8f9fa"
  destructive: "#a82745"
  rail-background: "#2e2b34"
  rail-foreground: "#f4f2f6"
  rail-primary: "#d5cce3"
  rail-primary-foreground: "#302b39"
  rail-muted: "#3a373f"
  rail-muted-foreground: "#c3becb"
  rail-accent: "#45414c"
  rail-accent-foreground: "#f4f2f6"
  rail-border: "#3b3742"
  rail-ring: "#d5cce3"
typography:
  headline:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "1.25"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    letterSpacing: "normal"
  body:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    letterSpacing: "normal"
  reading:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.75rem"
    letterSpacing: "normal"
  label:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
    letterSpacing: "normal"
  control:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
    letterSpacing: "normal"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  2xl: "1.125rem"
  card: "24px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    height: "2.25rem"
    padding: "0 0.75rem"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    height: "2.25rem"
    padding: "0 0.75rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    height: "2.25rem"
    padding: "0 0.75rem"
  input-search:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2.5rem"
    padding: "0.25rem 0.75rem"
  folder-current:
    backgroundColor: "{colors.rail-accent}"
    textColor: "{colors.rail-accent-foreground}"
    rounded: "{rounded.lg}"
    height: "2.5rem"
    padding: "0.5rem 0.75rem"
  tag-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.2xl}"
    typography: "{typography.label}"
    height: "1.25rem"
    padding: "0.125rem 0.5rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    typography: "{typography.body}"
    padding: "1.25rem"
  mail-unread:
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
---

# Design System: Mankr Flarepost

## Overview

**Creative North Star: "折页信笺"**

Flarepost is a working sheet for mail. A separate navigation plane frames the reading surface, and tonal surfaces and spacing make a busy list easy to scan. The existing Flarepost fold mark from `public/brand/` anchors the identity.

Light mode pairs a charcoal navigation plane with a trace of violet and a near-white workspace. In the workspace, muted violet marks branding, primary actions, links, and focus. Hover, selection, and unread states use shades of gray. Dark mode uses neutral graphite surfaces and reserves muted lavender for branding, actions, focus, and fine state markers. Use familiar controls and let weight, alignment and spacing do most of the work. Carry the same visual grammar through full width and narrow layouts, with equal care for both.

**Key Characteristics:**

- A distinct navigation plane against a quiet reading surface.
- Flat surfaces separated by tone and whitespace.
- Compact interface text with more line space for reading.
- Tonal selection and stronger text for states that need to stand out.

## Colors

The frontmatter records the light palette: white cards, a charcoal-violet navigation plane, and a near-white workspace. Dark mode uses the neutral graphite surfaces and muted lavender accents defined in `src/index.css`.

### Primary

- **Fold Violet** (`primary`): the compose and submit fill on paper and the color of links.
- **Focus Lavender** (`ring`): the keyboard focus outline.
- **Rail Lavender** (`rail-primary`): the light primary action fill on the charcoal navigation plane.

### Neutral

- **Fold Charcoal** (`rail-background`): the light-mode navigation plane, a dark gray with a trace of violet. Its hover and selected fills are scoped to the rail.
- **Reading Paper** (`main`) and **Card Paper** (`card`): the near-white workspace and white grouped controls. `background` provides the pale gray page ground.
- **Graphite Ink** (`foreground`) and **Quiet Ink** (`muted-foreground`): primary content and quieter metadata. Use background changes and whitespace to group content. Use `border` for subtle dividers and `input` for the stronger outlines of controls.
- **Gray Wash** (`accent`): hover and selection on paper. Use the gentler `secondary` for badges and notices.
- **Alert Rose** (`destructive`): errors and destructive actions.

**The Fold Rule.** Keep navigation visually separate from reading: charcoal-violet against near-white paper in light mode, deep graphite against charcoal in dark mode. The large fold mark on the light sign-in panel uses a pale gray tint; the small mark keeps the brand color.

## Typography

Inter Variable is shared by headings, controls and body copy, with a system sans-serif fallback. A message subject uses the headline role and wraps even with unbroken text. Subjects and sender names in a list use weight and placement to carry hierarchy; use tabular figures for times and counts. Give plain-text mail the reading role and a maximum line measure of 72ch. Compact metadata uses the label size, with medium weight for labels and regular weight for timestamps.

## Layout

The navigation occupies a 15rem rail from 48rem up. Below that, the navigation plane becomes a top bar with 44px action targets and a drawer for folders. The outer shell shares the navigation background in both themes, creating one continuous ground behind the workspace. The main workspace sits inside an 8px outer margin with 22px corners, with no left outer margin beside the desktop navigation and clipped overflow, using tonal separation without an outline. The workspace and reading column scroll independently of their controls.

Mailbox rows place sender and time on the first line and subject on the second below 40rem. At 40rem the same fields align into columns separated by whitespace. At 64rem search results add a folder column. Small gaps between softly rounded rows establish rhythm without horizontal rules. The reading surface, toolbar, and reply bar follow the workspace width. Let HTML messages use the available reading width, with horizontal overflow contained within the message. Keep the toolbar and reply controls available while reading, including mobile safe area padding.

## Elevation & Depth

The navigation rail, reading surface and card backgrounds establish depth. Tonal selection and stronger text denote state. Reserve elevation for overlays and other transient layers.

**The Flat Paper Rule.** Use a change of surface tone or whitespace to separate content at rest. Only use a subdued rule where a boundary is necessary.

## Shapes

The fold mark carries the signature geometry. Work surfaces use quiet tonal layers. Buttons, fields and folder controls have gently rounded corners (0.625rem); labels are pill shaped. Standalone cards can use softer corners (up to 24px) without an outline.

## Components

### Buttons

Use solid violet for the primary action and an outlined button for nearby alternatives. A ghost button fits low priority or icon actions. Use a visible focus ring and the existing hover treatment; pair icon-only controls with accessible names.

### Inputs / Fields

Search and text fields sit on card paper with a defined input border. Focus strengthens the border and adds a ring. Errors use the destructive stroke and ring. Field text is 1rem on narrow screens and 0.875rem at the desktop breakpoint.

### Chips

Secondary tags use a pale pill, compact type and direct labels. Their fill sits between white cards and the stronger gray of selected items.

### Cards / Containers

Card backgrounds, whitespace and even insets group settings and support content without outlines. The compact card uses 1rem insets; the standard card uses 1.25rem. Use small gaps and tonal backgrounds for collections.

### Navigation

Rail links use subdued labels until hovered or current. The current link combines the accent wash and heavier text. Retain folder names and counts in the mobile drawer.

### Unread mail row

Use the same row grid as read mail. Unread adds a tonal wash and semibold sender and subject. Hover or focus deepens the wash without shifting content. Keep the unread label available to assistive technology.

## Do's and Don'ts

- Do keep the existing Flarepost fold mark and wordmark legible on both navigation surfaces.
- Do give keyboard focus a visible lavender ring.
- Do pair unread tint with stronger text and an accessible unread label.
- Do keep the same message information within reach on desktop and mobile.

- Don’t float ordinary mailbox rows in individual shadowed cards.
- Don’t rely on tint alone to communicate unread or current state.
- Don’t use decorative glass or heavy shadows to divide the reading surface.
