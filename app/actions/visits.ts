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
}

export async function checkIn(input: CheckInInput): Promise<Visit> {
  const userId = await getUserId()
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
