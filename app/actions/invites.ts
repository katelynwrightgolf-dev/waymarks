"use server"

import { randomBytes } from "crypto"
import { and, desc, eq, isNull } from "drizzle-orm"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { invite } from "@/lib/db/schema"
import { isOwner, noAccountsYet } from "@/lib/invite-guard"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

/**
 * Only the owner may hand out invites. Enforced here in the data path rather
 * than by hiding the page, since a server action is a callable endpoint that
 * anyone signed in could otherwise invoke.
 */
async function getOwnerUserId() {
  const userId = await getUserId()
  if (!(await isOwner(userId))) throw new Error("Unauthorized")
  return userId
}

/** Whether the signed-in person is allowed to see the invite screen at all. */
export async function viewerIsOwner() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return false
  return isOwner(session.user.id)
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
  await getOwnerUserId()
  return db.select().from(invite).orderBy(desc(invite.createdAt))
}

export async function createInvite(label?: string) {
  const userId = await getOwnerUserId()
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
  await getOwnerUserId()
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
 * invite code (that's you), and it adopts the existing check-ins. Shares one
 * implementation with the sign-up gate so the two can never disagree.
 */
export async function isFirstRun() {
  return noAccountsYet()
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
 * Claiming a code and adopting the pre-account check-ins both happen inside
 * Better Auth's user-creation hook (see lib/invite-guard.ts). They are
 * deliberately not server actions: the sign-up HTTP endpoint is public, so a
 * check that only runs in the form could be skipped, and a callable
 * "adopt unowned visits" action could be invoked by any signed-in account.
 */
