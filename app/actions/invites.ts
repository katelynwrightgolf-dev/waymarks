"use server"

import { randomBytes } from "crypto"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { invite, user, visits } from "@/lib/db/schema"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

/** Human-friendly code: no 0/O/1/I to avoid transcription mistakes. */
function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = randomBytes(12)
  let out = ""
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) out += "-"
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

export async function listInvites() {
  await getUserId()
  return db.select().from(invite).orderBy(desc(invite.createdAt))
}

export async function createInvite(label?: string) {
  const userId = await getUserId()
  const trimmed = label?.trim()
  const [row] = await db
    .insert(invite)
    .values({
      code: generateCode(),
      label: trimmed && trimmed.length > 0 ? trimmed.slice(0, 60) : null,
      createdByUserId: userId,
    })
    .returning()
  revalidatePath("/invites")
  return row
}

export async function revokeInvite(id: number) {
  await getUserId()
  // Only unused invites can be revoked -- revoking a used one would be
  // meaningless since the account already exists.
  await db
    .update(invite)
    .set({ revokedAt: new Date() })
    .where(and(eq(invite.id, id), isNull(invite.usedByUserId), isNull(invite.revokedAt)))
  revalidatePath("/invites")
}

/**
 * True when no account exists yet. The very first sign-up is allowed without an
 * invite code (that's you), and it claims the existing check-ins.
 */
export async function isFirstRun() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(user)
  return (row?.n ?? 0) === 0
}

/**
 * Validates an invite code without consuming it, so the sign-up form can give
 * immediate feedback. Consumption happens in claimInvite() after the account
 * is actually created.
 */
export async function checkInviteCode(code: string) {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return { valid: false as const, reason: "Enter your invite code." }

  const [row] = await db.select().from(invite).where(eq(invite.code, normalized)).limit(1)
  if (!row) return { valid: false as const, reason: "That invite code doesn't exist." }
  if (row.revokedAt) return { valid: false as const, reason: "That invite code was revoked." }
  if (row.usedByUserId) return { valid: false as const, reason: "That invite code was already used." }
  return { valid: true as const }
}

/**
 * Marks an invite as used by the newly created account. The conditional UPDATE
 * is what makes this safe: two people racing the same code means only the
 * first UPDATE matches, and the loser is deleted below.
 */
export async function claimInvite(code: string) {
  const userId = await getUserId()
  const normalized = code.trim().toUpperCase()

  const claimed = await db
    .update(invite)
    .set({ usedByUserId: userId, usedAt: new Date() })
    .where(and(eq(invite.code, normalized), isNull(invite.usedByUserId), isNull(invite.revokedAt)))
    .returning()

  if (claimed.length === 0) {
    // The code was bad or taken between validation and account creation.
    // Remove the account we just made so no un-invited user can linger.
    await db.delete(user).where(eq(user.id, userId))
    throw new Error("That invite code is no longer valid.")
  }

  await db.update(user).set({ inviteCode: normalized }).where(eq(user.id, userId))
}

/**
 * One-time migration: the 62 check-ins logged before accounts existed have no
 * owner, so the first account to sign up adopts them.
 */
export async function claimOrphanVisits() {
  const userId = await getUserId()
  const rows = await db.update(visits).set({ userId }).where(isNull(visits.userId)).returning({ id: visits.id })
  revalidatePath("/")
  return rows.length
}
