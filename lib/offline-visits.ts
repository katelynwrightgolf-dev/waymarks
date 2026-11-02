"use client"

// Check-ins made with no signal wait here (in localStorage) and are sent to
// the server once the phone is back online. Each keeps the time it actually
// happened, so syncing later doesn't change when you were there.
//
// We also keep a copy of the visit log so the Visited tab still shows
// everything when the app is opened offline.

import type { CheckInInput } from "@/app/actions/visits"
import type { Visit } from "@/lib/db/schema"

const QUEUE_KEY = "waymarks:pending-checkins:v1"
const VISITS_KEY = "waymarks:visits:v1"

export type PendingCheckIn = {
  /** Negative, so it can never collide with a real visit id. */
  tempId: number
  input: CheckInInput & { visitedAt: string }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked; the in-memory state still works this session.
  }
}

export function readQueue(): PendingCheckIn[] {
  return read<PendingCheckIn[]>(QUEUE_KEY, [])
}

export function enqueueCheckIn(input: CheckInInput): PendingCheckIn {
  const queue = readQueue()
  const lowest = queue.reduce((min, p) => Math.min(min, p.tempId), 0)
  const entry: PendingCheckIn = { tempId: lowest - 1, input: { ...input, visitedAt: new Date().toISOString() } }
  write(QUEUE_KEY, [...queue, entry])
  return entry
}

export function removeQueued(tempId: number) {
  write(
    QUEUE_KEY,
    readQueue().filter((p) => p.tempId !== tempId),
  )
}

export function updateQueuedNote(tempId: number, note: string) {
  write(
    QUEUE_KEY,
    readQueue().map((p) => (p.tempId === tempId ? { ...p, input: { ...p.input, note: note.trim() || null } } : p)),
  )
}

export function pendingToVisit(p: PendingCheckIn): Visit {
  return {
    id: p.tempId,
    userId: null,
    landmarkId: p.input.landmarkId,
    name: p.input.name,
    description: p.input.description ?? null,
    category: p.input.category ?? null,
    lat: p.input.lat,
    lng: p.input.lng,
    note: p.input.note ?? null,
    visitedBy: p.input.visitedBy?.trim() || "Us",
    wikipedia: p.input.wikipedia ?? null,
    imageUrl: p.input.imageUrl ?? null,
    visitedAt: new Date(p.input.visitedAt),
  }
}

/** Pending check-ins first-class in the log, newest first. */
export function withPending(serverVisits: Visit[]): Visit[] {
  return [...readQueue().map(pendingToVisit), ...serverVisits.filter((v) => v.id > 0)].sort(
    (a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime(),
  )
}

export function saveVisitsCopy(visits: Visit[]) {
  write(
    VISITS_KEY,
    visits.filter((v) => v.id > 0),
  )
}

export function readVisitsCopy(): Visit[] | null {
  const rows = read<Visit[] | null>(VISITS_KEY, null)
  return rows ? rows.map((v) => ({ ...v, visitedAt: new Date(v.visitedAt) })) : null
}

/** Forget everything stored for this account on this device (sign-out). */
export async function clearOfflineData() {
  try {
    localStorage.removeItem(QUEUE_KEY)
    localStorage.removeItem(VISITS_KEY)
  } catch {}
  // The service worker's copy of the signed-in page.
  if (typeof caches !== "undefined") {
    for (const key of await caches.keys()) {
      if (key.startsWith("waymarks-pages")) await caches.delete(key)
    }
  }
}

/** True when a failed call looks like "no connection" rather than a server error. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true
  if (err instanceof TypeError) return true
  const message = err instanceof Error ? err.message : String(err)
  return /failed to fetch|load failed|network ?error|networkerror|offline/i.test(message)
}
