import type { ComponentPropsWithoutRef, ElementType } from "react"

import { cn } from "@/lib/utils"

type LiquidGlassProps<T extends ElementType = "div"> = {
  as?: T
  /** Optional frost blur — still does not set fill */
  clear?: boolean
  /** Hover / press feedback */
  interactive?: boolean
  className?: string
  children?: React.ReactNode
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">

/**
 * Highlight-only liquid glass overlay.
 * Set background yourself, e.g. `className="liquid-glass bg-accent …"`.
 */
function LiquidGlass<T extends ElementType = "div">({
  as,
  clear = false,
  interactive = false,
  className,
  children,
  ...props
}: LiquidGlassProps<T>) {
  const Comp = as ?? "div"

  return (
    <Comp
      className={cn(
        "liquid-glass",
        clear && "liquid-glass-clear",
        interactive && "liquid-glass-interactive",
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}

export { LiquidGlass }
export type { LiquidGlassProps }
