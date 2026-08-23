import { and, eq, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { invite, user, visits } from "@/lib/db/schema"

/**
 * Invite enforcement lives here rather than in a server action because the
 * Better Auth sign-up endpoint (/api/auth/sign-up/email) is a public HTTP
 * route. A check that only runs in the sign-up form can be skipped entirely by
 * POSTing to that endpoint directly, so the gate has to sit inside Better
 * Auth's own user-creation path. lib/auth.ts calls these from a database hook.
 *
 * Plain functions, not "use server" actions: these must never be callable from
 * the browser.
 */

export function normalizeCode(raw: unknown) {
  return typeof raw === "string" ? raw.trim().toUpperCase() : ""
}

/** True when no account exists yet, which makes the next sign-up the owner. */
export async function noAccountsYet() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(user)
  return (row?.n ?? 0) === 0
}

/**
 * The owner is the first account ever created. Identifying them by creation
 * order rather than a flag means it stays correct for the account that already
 * existed before invites were added.
 */
export async function isOwner(userId: string) {
  const [first] = await db.select({ id: user.id }).from(user).orderBy(user.createdAt).limit(1)
  return Boolean(first) && first.id === userId
}

/**
 * Atomically reserves an invite code. The single conditional UPDATE is what
 * makes this race-safe: if two people submit the same code at the same moment,
 * only one UPDATE can match `usedAt IS NULL`, so only one of them proceeds.
 *
 * Returns false when the code is missing, revoked, or already spent. The caller
 * must reject the sign-up in that case, so a rejected code never creates a row.
 */
export async function reserveInviteCode(code: string) {
  const normalized = normalizeCode(code)
  if (!normalized) return false

  const reserved = await db
    .update(invite)
    .set({ usedAt: new Date() })
    .where(and(eq(invite.code, normalized), isNull(invite.usedAt), isNull(invite.revokedAt)))
    .returning({ id: invite.id })

  return reserved.length > 0
}

/**
 * Attaches a reserved code to the account that just used it. Called after the
 * user row exists, since that is when the id is known.
 */
export async function attachInviteToUser(code: string, userId: string) {
  const normalized = normalizeCode(code)
  if (!normalized) return
  await db.update(invite).set({ usedByUserId: userId }).where(eq(invite.code, normalized))
}

/**
 * One-time migration for the check-ins logged before accounts existed: they
 * have no owner, so the owner account adopts them. This runs inside user
 * creation rather than as a callable action -- as an action, any signed-in
 * account could invoke it and take the unowned rows.
 */
export async function adoptOrphanVisits(userId: string) {
  const rows = await db
    .update(visits)
    .set({ userId })
    .where(isNull(visits.userId))
    .returning({ id: visits.id })
  return rows.length
}
