"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface IndicatorRect {
  height: number
  left: number
  top: number
  width: number
}

interface SegmentedProps<T extends string | number> {
  /** 当前选中值 */
  value: T
  /** 选中变化回调 */
  onChange: (value: T) => void
  /** 可选项列表 */
  options: readonly T[]
  /** 选项展示文案渲染函数 */
  renderLabel?: (value: T) => React.ReactNode
  /** 是否禁用某选项 */
  isOptionDisabled?: (value: T) => boolean
  /** 选项 title（悬停提示） */
  getOptionTitle?: (value: T) => string | undefined
  /** 附加轨道样式 */
  className?: string
  /**
   * 布局：grid 多列网格；row 单行横滑
   * @default "grid"
   */
  layout?: "grid" | "row"
  /** 网格列数 */
  columnCount?: number
  /** 按钮附加样式 */
  buttonClassName?: string
}

/** hover 时滑块向邻项方向微延伸的像素量 */
const INDICATOR_HOVER_PEEK_PX = 5

function applyHoverPeek(
  rect: IndicatorRect,
  activeIndex: number,
  hoveredIndex: number,
  columnCount: number,
  peek = INDICATOR_HOVER_PEEK_PX
): IndicatorRect {
  if (activeIndex < 0 || hoveredIndex < 0 || activeIndex === hoveredIndex) {
    return rect
  }

  const activeRow = Math.floor(activeIndex / columnCount)
  const activeCol = activeIndex % columnCount
  const hoveredRow = Math.floor(hoveredIndex / columnCount)
  const hoveredCol = hoveredIndex % columnCount

  let { left, top, width, height } = rect

  if (activeRow === hoveredRow) {
    if (hoveredCol < activeCol) {
      left -= peek
      width += peek
    } else if (hoveredCol > activeCol) {
      width += peek
    }
    return { left, top, width, height }
  }

  if (activeCol === hoveredCol) {
    if (hoveredRow < activeRow) {
      top -= peek
      height += peek
    } else if (hoveredRow > activeRow) {
      height += peek
    }
  }

  return { left, top, width, height }
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  renderLabel,
  isOptionDisabled,
  getOptionTitle,
  className,
  layout = "grid",
  columnCount: columnCountProp,
  buttonClassName,
}: SegmentedProps<T>): React.ReactElement {
  const trackRef = React.useRef<HTMLDivElement>(null)
  const buttonRefs = React.useRef(new Map<T, HTMLButtonElement>())
  const [hoveredValue, setHoveredValue] = React.useState<T | null>(null)
  const [indicatorRect, setIndicatorRect] =
    React.useState<IndicatorRect | null>(null)

  const isRowLayout = layout === "row"
  const columnCount = isRowLayout
    ? Math.max(options.length, 1)
    : (columnCountProp ?? Math.min(options.length, 4))

  const computeIndicatorRect = React.useCallback((): IndicatorRect | null => {
    const track = trackRef.current
    const activeButton = buttonRefs.current.get(value)
    if (!track || !activeButton) {
      return null
    }

    let rect: IndicatorRect = {
      left: activeButton.offsetLeft,
      top: activeButton.offsetTop,
      width: activeButton.offsetWidth,
      height: activeButton.offsetHeight,
    }

    if (hoveredValue != null && hoveredValue !== value) {
      const hoveredButton = buttonRefs.current.get(hoveredValue)
      if (hoveredButton) {
        const activeIndex = options.indexOf(value)
        const hoveredIndex = options.indexOf(hoveredValue)
        rect = applyHoverPeek(rect, activeIndex, hoveredIndex, columnCount)
      }
    }

    return rect
  }, [columnCount, hoveredValue, options, value])

  const syncIndicator = React.useCallback(() => {
    setIndicatorRect(computeIndicatorRect())
  }, [computeIndicatorRect])

  React.useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync indicator geometry after layout
    syncIndicator()
  }, [syncIndicator])

  React.useEffect(() => {
    const track = trackRef.current
    if (!track) return

    syncIndicator()

    const observer = new ResizeObserver(() => {
      syncIndicator()
    })

    observer.observe(track)
    return () => observer.disconnect()
  }, [syncIndicator])

  const setButtonRef = React.useCallback(
    (option: T) => (node: HTMLButtonElement | null) => {
      if (node) {
        buttonRefs.current.set(option, node)
      } else {
        buttonRefs.current.delete(option)
      }
    },
    []
  )

  const clearHover = React.useCallback(() => {
    setHoveredValue(null)
  }, [])

  return (
    <div
      ref={trackRef}
      onMouseLeave={clearHover}
      className={cn(
        "segmented-track relative inline-flex flex-row items-center overflow-hidden rounded-3xl border border-border/50 bg-input/40 p-1 text-muted-foreground dark:border-white/5 dark:bg-background/60",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "segmented-indicator pointer-events-none absolute z-0 rounded-2xl border border-border/60 bg-background text-foreground shadow-2xs dark:border-white/10 dark:bg-accent dark:shadow-sm",
          indicatorRect ? "opacity-100" : "opacity-0"
        )}
        style={{
          height: indicatorRect?.height ?? 0,
          left: indicatorRect?.left ?? 0,
          top: indicatorRect?.top ?? 0,
          width: indicatorRect?.width ?? 0,
          transition:
            "left 300ms cubic-bezier(0.32, 0.72, 0, 1), top 300ms cubic-bezier(0.32, 0.72, 0, 1), width 300ms cubic-bezier(0.32, 0.72, 0, 1), height 300ms cubic-bezier(0.32, 0.72, 0, 1), opacity 150ms ease-out",
        }}
      />
      {options.map((option) => {
        const isSelected = value === option
        const isDisabled = isOptionDisabled?.(option) ?? false

        return (
          <button
            key={String(option)}
            ref={setButtonRef(option)}
            type="button"
            aria-pressed={isSelected}
            aria-disabled={isDisabled || undefined}
            disabled={isDisabled}
            title={getOptionTitle?.(option)}
            className={cn(
              "segmented-button relative z-10 inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border-0 bg-transparent px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 aria-pressed:font-medium aria-pressed:text-foreground",
              isRowLayout && "flex-1 basis-0",
              buttonClassName
            )}
            onClick={() => {
              if (isDisabled) return
              onChange(option)
            }}
            onMouseEnter={() => {
              if (isDisabled) return
              setHoveredValue(option)
            }}
          >
            {renderLabel ? renderLabel(option) : option}
          </button>
        )
      })}
    </div>
  )
}

export default Segmented
