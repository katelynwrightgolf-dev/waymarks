"use client"

import type { Visit } from "@/lib/db/schema"
import { wikipediaUrl } from "@/lib/landmarks"
import { placeInfoUrl } from "@/lib/places"
import { fullDate, timeAgo } from "@/lib/time"
import { ExternalLink, MapPin, Navigation } from "lucide-react"

export function RecentVisit({ visit }: { visit: Visit }) {
  const wiki = wikipediaUrl(visit.wikipedia) ?? placeInfoUrl(visit.landmarkId)
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${visit.lat},${visit.lng}`

  return (
    <section
      aria-label="Most recent landmark"
      className="relative overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground shadow-lg"
    >
      {visit.imageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={visit.imageUrl || "/placeholder.svg"}
            alt={visit.name}
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-primary/80" aria-hidden />
        </>
      ) : null}
      <div className="relative">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase opacity-90">
          <Navigation className="size-4" aria-hidden />
          You were just by
        </div>

      <h2 className="mt-2 font-serif text-3xl leading-tight text-balance">{visit.name}</h2>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm opacity-90">
        {visit.category ? <span>{visit.category}</span> : null}
        <span aria-hidden>·</span>
        <span suppressHydrationWarning>{timeAgo(visit.visitedAt)}</span>
      </div>

      {visit.description ? (
        <p className="mt-4 text-sm leading-relaxed opacity-95 text-pretty">{visit.description}</p>
      ) : null}

      {visit.note ? (
        <p className="mt-4 rounded-2xl bg-primary-foreground/10 p-3 text-sm leading-relaxed">
          &ldquo;{visit.note}&rdquo;
        </p>
      ) : null}

      <div className="mt-3 text-sm opacity-90" suppressHydrationWarning>
        Logged by {visit.visitedBy} · {fullDate(visit.visitedAt)}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary-foreground px-4 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
        >
          <MapPin className="size-4" aria-hidden />
          Directions
        </a>
        {wiki ? (
          <a
            href={wiki}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary-foreground/40 px-4 text-sm font-semibold transition-colors hover:bg-primary-foreground/10"
          >
            <ExternalLink className="size-4" aria-hidden />
            Read more
          </a>
        ) : null}
        </div>
      </div>
    </section>
  )
}
