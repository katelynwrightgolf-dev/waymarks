export function timeAgo(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Stable per-day key in local time, for grouping visits by day. */
export function dayKey(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** "Today", "Yesterday", or e.g. "Saturday, Oct 24" (with the year if it isn't this year). */
export function dayLabel(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  })
}

export function timeOfDay(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export function fullDate(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
