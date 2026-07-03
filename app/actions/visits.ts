"use server"

import { db } from "@/lib/db"
import { visits, type Visit } from "@/lib/db/schema"
import { desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function getVisits(): Promise<Visit[]> {
  return db.select().from(visits).orderBy(desc(visits.visitedAt))
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
}

export async function checkIn(input: CheckInInput): Promise<Visit> {
  const [row] = await db
    .insert(visits)
    .values({
      landmarkId: input.landmarkId,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      lat: input.lat,
      lng: input.lng,
      note: input.note ?? null,
      visitedBy: input.visitedBy?.trim() || "Us",
      wikipedia: input.wikipedia ?? null,
    })
    .returning()
  revalidatePath("/")
  return row
}

export async function updateNote(id: number, note: string): Promise<void> {
  await db.update(visits).set({ note: note.trim() || null }).where(eq(visits.id, id))
  revalidatePath("/")
}

export async function deleteVisit(id: number): Promise<void> {
  await db.delete(visits).where(eq(visits.id, id))
  revalidatePath("/")
}
