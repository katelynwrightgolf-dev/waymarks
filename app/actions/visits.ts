"use server"

import { db } from "@/lib/db"
import { visits, type Visit } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import { auth } from "@/lib/auth"

/**
 * There is no row-level security on Neon, so EVERY query below is scoped by
 * this id. The `eq(visits.userId, userId)` in each where clause is the only
 * thing keeping one person's log out of another's.
 */
async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function getVisits(): Promise<Visit[]> {
  const userId = await getUserId()
  return db.select().from(visits).where(eq(visits.userId, userId)).orderBy(desc(visits.visitedAt))
}

export type CheckInInput = {
  landmarkId: string
  name: string
  description?: string | null
  category?: string | null
  lat: number
  lng: number
  note?: string | null
  visitedBy?: string
  wikipedia?: string | null
  imageUrl?: string | null
  /** When it actually happened, for check-ins saved offline and synced later. */
  visitedAt?: string
}

/** Accept a client-supplied time only if it's plausible (past year, not future). */
function parseVisitedAt(raw?: string): Date | null {
  if (!raw) return null
  const at = new Date(raw)
  const t = at.getTime()
  const now = Date.now()
  if (Number.isNaN(t) || t > now + 5 * 60_000 || t < now - 365 * 86_400_000) return null
  return at
}

export async function checkIn(input: CheckInInput): Promise<Visit> {
  const userId = await getUserId()
  const visitedAt = parseVisitedAt(input.visitedAt)
  if (visitedAt) {
    // An offline check-in whose sync is retried (e.g. the reply was lost when
    // signal dropped) must not be logged twice.
    const [existing] = await db
      .select()
      .from(visits)
      .where(
        and(eq(visits.userId, userId), eq(visits.landmarkId, input.landmarkId), eq(visits.visitedAt, visitedAt)),
      )
      .limit(1)
    if (existing) return existing
  }
  const [row] = await db
    .insert(visits)
    .values({
      userId,
      landmarkId: input.landmarkId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      lat: input.lat,
      lng: input.lng,
      note: input.note ?? null,
      visitedBy: input.visitedBy?.trim() || "Us",
      wikipedia: input.wikipedia ?? null,
      imageUrl: input.imageUrl ?? null,
      ...(visitedAt ? { visitedAt } : {}),
    })
    .returning()
  revalidatePath("/")
  return row
}

export async function updateNote(id: number, note: string): Promise<void> {
  const userId = await getUserId()
  await db
    .update(visits)
    .set({ note: note.trim() || null })
    .where(and(eq(visits.id, id), eq(visits.userId, userId)))
  revalidatePath("/")
}

export async function deleteVisit(id: number): Promise<void> {
  const userId = await getUserId()
  await db.delete(visits).where(and(eq(visits.id, id), eq(visits.userId, userId)))
  revalidatePath("/")
}
