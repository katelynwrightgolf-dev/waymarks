import { doublePrecision, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

// A shared log of historic buildings and landmarks the couple has visited.
export const visits = pgTable("visits", {
  id: serial("id").primaryKey(),
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
export const landmarkFacts = pgTable("landmark_facts", {
  landmarkId: text("landmark_id").primaryKey(),
  facts: text("facts").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type LandmarkFacts = typeof landmarkFacts.$inferSelect
