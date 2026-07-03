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
