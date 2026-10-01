import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react"

function Icon({
  color = "currentColor",
  strokeWidth = 1.5,
  ...props
}: HugeiconsIconProps) {
  return <HugeiconsIcon color={color} strokeWidth={strokeWidth} {...props} />
}

export { Icon }
