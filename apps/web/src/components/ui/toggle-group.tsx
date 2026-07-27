"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

interface IndicatorRect {
  left: number
  top: number
  width: number
  height: number
  ready: boolean
}

interface ToggleGroupContextValue {
  variant?: VariantProps<typeof toggleVariants>["variant"]
  size?: VariantProps<typeof toggleVariants>["size"]
  spacing?: number
  orientation?: "horizontal" | "vertical"
  registerItem: (value: string, node: HTMLElement | null) => void
  setHoveredValue: (value: string | null) => void
  hoveredValue: string | null
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue>({
  size: "default",
  variant: "default",
  spacing: 0,
  orientation: "horizontal",
  registerItem: () => {},
  setHoveredValue: () => {},
  hoveredValue: null,
})

function ToggleGroup({
  className,
  variant = "default",
  size = "default",
  spacing = 0,
  orientation = "horizontal",
  children,
  value,
  defaultValue,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const itemMapRef = React.useRef<Map<string, HTMLElement>>(new Map())
  const [hoveredValue, setHoveredValue] = React.useState<string | null>(null)

  const [sliderRect, setSliderRect] = React.useState<IndicatorRect>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    ready: false,
  })

  const registerItem = React.useCallback(
    (itemValue: string, node: HTMLElement | null) => {
      if (node) {
        itemMapRef.current.set(itemValue, node)
      } else {
        itemMapRef.current.delete(itemValue)
      }
    },
    []
  )

  const computeIndicatorRect = React.useCallback((): IndicatorRect | null => {
    const container = containerRef.current
    if (!container) return null

    const activeEl = container.querySelector<HTMLElement>(
      '[data-state="on"], [aria-pressed="true"], [data-pressed="true"]'
    )

    if (!activeEl) {
      return null
    }

    let left = activeEl.offsetLeft
    let top = activeEl.offsetTop
    let width = activeEl.offsetWidth
    let height = activeEl.offsetHeight

    if (hoveredValue && container.contains(itemMapRef.current.get(hoveredValue) || null)) {
      const hoveredEl = itemMapRef.current.get(hoveredValue)
      if (hoveredEl && hoveredEl !== activeEl) {
        const PEEK_PX = 3

        if (orientation === "vertical") {
          if (hoveredEl.offsetTop < activeEl.offsetTop) {
            top -= PEEK_PX
            height += PEEK_PX
          } else if (hoveredEl.offsetTop > activeEl.offsetTop) {
            height += PEEK_PX
          }
        } else {
          if (hoveredEl.offsetLeft < activeEl.offsetLeft) {
            left -= PEEK_PX
            width += PEEK_PX
          } else if (hoveredEl.offsetLeft > activeEl.offsetLeft) {
            width += PEEK_PX
          }
        }
      }
    }

    return {
      left,
      top,
      width,
      height,
      ready: true,
    }
  }, [hoveredValue, orientation])

  const syncIndicator = React.useCallback(() => {
    const rect = computeIndicatorRect()
    if (rect) {
      setSliderRect(rect)
    } else {
      setSliderRect((prev) => (prev.ready ? { ...prev, ready: false } : prev))
    }
  }, [computeIndicatorRect])

  React.useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync slider layout
    syncIndicator()
  }, [syncIndicator])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    syncIndicator()

    const resizeObserver = new ResizeObserver(syncIndicator)
    resizeObserver.observe(container)

    Array.from(container.children).forEach((child) => {
      if (child.getAttribute("data-slot") !== "toggle-group-slider") {
        resizeObserver.observe(child)
      }
    })

    const mutationObserver = new MutationObserver(syncIndicator)
    mutationObserver.observe(container, {
      attributes: true,
      attributeFilter: ["aria-pressed", "data-pressed", "data-state", "class"],
      subtree: true,
    })

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [syncIndicator])

  const handleMouseLeave = () => {
    setHoveredValue(null)
  }

  return (
    <ToggleGroupPrimitive
      ref={containerRef}
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      value={value}
      defaultValue={defaultValue}
      onMouseLeave={handleMouseLeave}
      style={{ "--gap": `${spacing}px` } as React.CSSProperties}
      className={cn(
        "group/toggle-group relative inline-flex flex-row items-center p-1 rounded-2xl bg-input/40 border border-border/50 text-muted-foreground dark:bg-background/60 dark:border-white/5 data-vertical:flex-col data-vertical:items-stretch overflow-hidden",
        className
      )}
      {...props}
    >
      <div
        data-slot="toggle-group-slider"
        aria-hidden
        className={cn(
          "pointer-events-none absolute z-0 rounded-xl bg-background text-foreground shadow-2xs border border-border/60 dark:bg-accent dark:border-white/10 dark:shadow-sm",
          sliderRect.ready ? "opacity-100" : "opacity-0"
        )}
        style={{
          left: `${sliderRect.left}px`,
          top: `${sliderRect.top}px`,
          width: `${sliderRect.width}px`,
          height: `${sliderRect.height}px`,
          transition: sliderRect.ready
            ? "left 300ms cubic-bezier(0.32, 0.72, 0, 1), top 300ms cubic-bezier(0.32, 0.72, 0, 1), width 300ms cubic-bezier(0.32, 0.72, 0, 1), height 300ms cubic-bezier(0.32, 0.72, 0, 1), opacity 150ms ease-out"
            : "opacity 150ms ease-out",
        }}
      />
      <ToggleGroupContext.Provider
        value={{
          variant,
          size,
          spacing,
          orientation,
          registerItem,
          setHoveredValue,
          hoveredValue,
        }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  value = "",
  ...props
}: TogglePrimitive.Props &
  VariantProps<typeof toggleVariants> & { value?: string }) {
  const context = React.useContext(ToggleGroupContext)
  const itemRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (value) {
      context.registerItem(value, itemRef.current)
    }
    return () => {
      if (value) {
        context.registerItem(value, null)
      }
    }
  }, [value, context])

  return (
    <TogglePrimitive
      ref={itemRef}
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      value={value}
      onMouseEnter={() => {
        if (value) {
          context.setHoveredValue(value)
        }
      }}
      className={cn(
        "relative z-10 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-medium cursor-pointer transition-colors duration-150 text-muted-foreground hover:text-foreground data-[state=on]:text-foreground data-[state=on]:font-semibold bg-transparent border-0 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "bg-transparent border-0 shadow-none hover:bg-transparent data-[state=on]:bg-transparent aria-pressed:bg-transparent",
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
