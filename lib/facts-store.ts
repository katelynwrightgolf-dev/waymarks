import { db } from "@/lib/db"
import { landmarkFacts } from "@/lib/db/schema"
import { eq, sql } from "drizzle-orm"

// Create the cache table on first use. The Neon MCP isn't available in this
// project (the integration was connected outside the Marketplace), so we run
// this idempotent DDL through the app's own pooled connection. Cached in a
// module-level promise so it only runs once per server instance.
let ensured: Promise<void> | null = null
function ensureFactsTable(): Promise<void> {
  if (!ensured) {
    ensured = db
      .execute(
        sql`CREATE TABLE IF NOT EXISTS landmark_facts (
          landmark_id text PRIMARY KEY,
          facts text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
      )
      .then(() => undefined)
      .catch((error) => {
        // Reset so a later call can retry if the first attempt failed.
        ensured = null
        throw error
      })
  }
  return ensured
}

// Returns the cached facts for a landmark, or null if none are stored yet.
export async function getCachedFacts(landmarkId: string): Promise<string[] | null> {
  await ensureFactsTable()
  const [row] = await db
    .select()
    .from(landmarkFacts)
    .where(eq(landmarkFacts.landmarkId, landmarkId))
    .limit(1)
  if (!row) return null
  try {
    const parsed = JSON.parse(row.facts) as unknown
    if (!Array.isArray(parsed)) return null
    // Sanitize on read so older cached rows that captured a stray markdown
    // heading line get cleaned up without needing to regenerate.
    const cleaned = (parsed as string[])
      .map((f) => (typeof f === "string" ? f.trim() : ""))
      .filter((f) => f.length > 0 && !f.startsWith("#"))
    return cleaned.length > 0 ? cleaned : null
  } catch {
    return null
  }
}

// Persists freshly generated facts, overwriting any previous entry.
export async function saveFacts(landmarkId: string, facts: string[]): Promise<void> {
  await ensureFactsTable()
  const encoded = JSON.stringify(facts)
  await db
    .insert(landmarkFacts)
    .values({ landmarkId, facts: encoded })
    .onConflictDoUpdate({
      target: landmarkFacts.landmarkId,
      set: { facts: encoded, createdAt: new Date() },
    })
}
