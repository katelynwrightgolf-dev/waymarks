import { boolean, doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

// --- Better Auth required tables -------------------------------------------
// Column names are camelCase to match Better Auth's defaults. Do not rename.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  // Added by the username plugin: this is what people actually sign in with.
  username: text("username").unique(),
  displayUsername: text("displayUsername"),
  // Audit trail: which invite code let this person in ("owner" for the first
  // account, which bootstraps the app before any invites exist).
  inviteCode: text("inviteCode"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  // Required by Better Auth 1.7+: identifies the credential issuer.
  issuer: text("issuer"),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
})

// Passkey credentials (Face ID / fingerprint / security key). Field names and
// types mirror @better-auth/passkey's schema exactly.
export const passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("publicKey").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credentialID").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("deviceType").notNull(),
  backedUp: boolean("backedUp").notNull(),
  transports: text("transports"),
  aaguid: text("aaguid"),
  createdAt: timestamp("createdAt").defaultNow(),
})

// --- App tables ------------------------------------------------------------

// One-time invite codes. The app is invite-only: apart from the very first
// (owner) account, signing up requires an unused, unexpired code.
export const invite = pgTable("invite", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  // Optional label ("for Mom") so you can tell the codes apart.
  label: text("label"),
  createdByUserId: text("createdByUserId"),
  // Set once the code is redeemed, which is what makes it single-use.
  usedByUserId: text("usedByUserId"),
  usedAt: timestamp("usedAt"),
  // Set when you cancel an unused code before anyone signs up with it.
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export type Invite = typeof invite.$inferSelect

// Each person's own private log of historic places they've visited.
export const visits = pgTable("visits", {
  id: serial("id").primaryKey(),
  // Scoping column. Every read and write filters on this — there is no RLS on
  // Neon, so this is what keeps one person's log out of another's.
  userId: text("user_id"),
  landmarkId: text("landmark_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  note: text("note"),
  visitedBy: text("visited_by").notNull().default("Us"),
  wikipedia: text("wikipedia"),
  imageUrl: text("image_url"),
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Visit = typeof visits.$inferSelect
export type NewVisit = typeof visits.$inferInsert

// Cache of AI-generated "interesting facts" per landmark, so we only ever pay
// to generate them once. Keyed by the stable landmark id (e.g. "wikipedia/123"
// or "osm/node/456"). Facts are stored as a JSON-encoded string array.
// Deliberately NOT per-user: the facts about a place are the same for everyone,
// so the cache is shared and contains no personal data.
export const landmarkFacts = pgTable("landmark_facts", {
  landmarkId: text("landmark_id").primaryKey(),
  facts: text("facts").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type LandmarkFacts = typeof landmarkFacts.$inferSelect
