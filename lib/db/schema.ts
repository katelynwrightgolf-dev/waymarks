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
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Visit = typeof visits.$inferSelect
export type NewVisit = typeof visits.$inferInsert
