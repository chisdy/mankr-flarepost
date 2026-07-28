const BYTES_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

export function formatCount(value: number) {
  return value.toLocaleString()
}

export function formatBytes(value: number) {
  if (value <= 0) return "0 B"
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    BYTES_UNITS.length - 1
  )
  const scaled = value / 1024 ** exponent
  return `${scaled.toFixed(scaled >= 10 || exponent === 0 ? 0 : 1)} ${BYTES_UNITS[exponent]}`
}
