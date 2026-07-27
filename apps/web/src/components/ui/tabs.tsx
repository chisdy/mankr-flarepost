"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const [hoverDir, setHoverDir] = React.useState<"left" | "right" | null>(null)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const list = listRef.current
    if (!list) return

    const activeTab = list.querySelector<HTMLElement>(
      '[data-selected], [aria-selected="true"]'
    )
    if (!activeTab) {
      if (hoverDir !== null) setHoverDir(null)
      return
    }

    const target = e.target as HTMLElement
    const hoveredTab = target.closest<HTMLElement>('[data-slot="tabs-tab"]')

    if (!hoveredTab || hoveredTab === activeTab) {
      if (hoverDir !== null) setHoverDir(null)
      return
    }

    if (hoveredTab.offsetLeft < activeTab.offsetLeft) {
      if (hoverDir !== "left") setHoverDir("left")
    } else if (hoveredTab.offsetLeft > activeTab.offsetLeft) {
      if (hoverDir !== "right") setHoverDir("right")
    }
  }

  const handleMouseLeave = () => {
    setHoverDir(null)
  }

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-hover-dir={hoverDir}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "group/tabs-list relative inline-flex flex-row items-center p-1 rounded-2xl bg-input/40 border border-border/50 text-muted-foreground dark:bg-background/60 dark:border-white/5 overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTab({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "relative z-10 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-medium cursor-pointer transition-colors duration-150 text-muted-foreground hover:text-foreground data-[selected]:text-foreground data-[selected]:font-semibold bg-transparent border-0 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function TabsIndicator({
  className,
  style,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Indicator>) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        "absolute z-0 rounded-xl bg-background text-foreground shadow-2xs border border-border/60 dark:bg-accent dark:border-white/10 dark:shadow-sm",
        "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "group-data-[hover-dir=left]/tabs-list:-ml-[3px] group-data-[hover-dir=left]/tabs-list:![width:calc(100%+3px)]",
        "group-data-[hover-dir=right]/tabs-list:![width:calc(100%+3px)]",
        className
      )}
      style={style}
      {...props}
    />
  )
}

function TabsPanel({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel }
