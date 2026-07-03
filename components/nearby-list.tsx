"use client"

import { formatDistance, wikipediaUrl, type Landmark } from "@/lib/landmarks"
import { Check, CheckCircle2, ExternalLink, Loader2, MapPin } from "lucide-react"

type NearbyListProps = {
  landmarks: Landmark[]
  visitedIds: Set<string>
  selectedId: string | null
  pendingId: string | null
  onSelect: (id: string) => void
  onCheckIn: (landmark: Landmark) => void
}

export function NearbyList({
  landmarks,
  visitedIds,
  selectedId,
  pendingId,
  onSelect,
  onCheckIn,
}: NearbyListProps) {
  if (landmarks.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No historic landmarks found in this area yet. Try widening the search radius.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {landmarks.map((lm) => {
        const visited = visitedIds.has(lm.id)
        const selected = selectedId === lm.id
        const pending = pendingId === lm.id
        const wiki = wikipediaUrl(lm.wikipedia)

        return (
          <li key={lm.id}>
            <article
              onClick={() => onSelect(lm.id)}
              className={`rounded-2xl border bg-card p-4 transition-colors ${
                selected ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-serif text-lg leading-snug text-card-foreground text-pretty">
                    {lm.name}
                  </h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
                      {lm.category}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden />
                      {formatDistance(lm.distanceMeters)}
                    </span>
                  </div>
                </div>
                {visited ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/30 px-2 py-1 text-xs font-semibold text-accent-foreground">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    Visited
                  </span>
                ) : null}
              </div>

              {lm.description ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{lm.description}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCheckIn(lm)
                  }}
                  disabled={pending}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Check className="size-4" aria-hidden />
                  )}
                  {visited ? "Log again" : "I was by this"}
                </button>
                {wiki ? (
                  <a
                    href={wiki}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                    Info
                  </a>
                ) : null}
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
