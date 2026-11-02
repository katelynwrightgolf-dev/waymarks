"use client"

import { formatDistance, wikipediaUrl, type Landmark } from "@/lib/landmarks"
import { Check, CheckCircle2, ExternalLink, Loader2, MapPin, Sparkles } from "lucide-react"
import { useCallback, useState } from "react"

type NearbyListProps = {
  landmarks: Landmark[]
  visitedIds: Set<string>
  selectedId: string | null
  pendingId: string | null
  onSelect: (id: string) => void
  onCheckIn: (landmark: Landmark) => void
  locationLabel?: string | null
}

type FactsState = {
  loading: boolean
  facts: string[] | null
  error: string | null
}

export function NearbyList({
  landmarks,
  visitedIds,
  selectedId,
  pendingId,
  onSelect,
  onCheckIn,
  locationLabel,
}: NearbyListProps) {
  // Track AI-generated facts per landmark id so each card manages its own state.
  const [factsById, setFactsById] = useState<Record<string, FactsState>>({})

  const loadFacts = useCallback(
    async (lm: Landmark) => {
      setFactsById((prev) => ({
        ...prev,
        [lm.id]: { loading: true, facts: null, error: null },
      }))
      try {
        const res = await fetch("/api/facts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            landmarkId: lm.id,
            name: lm.name,
            category: lm.category,
            kind: lm.kind,
            description: lm.description,
            locationLabel,
          }),
        })
        const data = await res.json()
        if (!res.ok || !Array.isArray(data.facts)) {
          throw new Error(data.error || "Failed to load facts.")
        }
        setFactsById((prev) => ({
          ...prev,
          [lm.id]: { loading: false, facts: data.facts as string[], error: null },
        }))
      } catch (err) {
        setFactsById((prev) => ({
          ...prev,
          [lm.id]: {
            loading: false,
            facts: null,
            error: err instanceof Error ? err.message : "Failed to load facts.",
          },
        }))
      }
    },
    [locationLabel],
  )

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
        const facts = factsById[lm.id]

        return (
          <li key={lm.id}>
            <article
              onClick={() => onSelect(lm.id)}
              className={`rounded-2xl border bg-card p-4 transition-colors ${
                selected ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              <div className="flex items-start gap-3">
                {lm.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={lm.imageUrl || "/placeholder.svg"}
                    alt={lm.name}
                    loading="lazy"
                    className="size-16 shrink-0 rounded-xl object-cover"
                  />
                ) : null}
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-serif text-lg leading-snug text-card-foreground text-pretty">
                      {lm.name}
                    </h3>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {lm.category ? (
                        <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
                          {lm.category}
                        </span>
                      ) : null}
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
              </div>

              {/* Long Wikipedia summaries stay to three lines until you tap the card. */}
              {lm.description ? (
                <p
                  className={`mt-2 text-sm leading-relaxed text-muted-foreground ${selected ? "" : "line-clamp-3"}`}
                >
                  {lm.description}
                </p>
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

              {/* AI-generated interesting facts, loaded on demand per landmark. */}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void loadFacts(lm)
                  }}
                  disabled={facts?.loading}
                  className="inline-flex min-h-9 items-center gap-2 rounded-full px-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                >
                  {facts?.loading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="size-4" aria-hidden />
                  )}
                  {facts?.facts ? "Show more facts" : "Interesting facts"}
                </button>

                {facts?.facts ? (
                  <ul className="mt-2 flex flex-col gap-2 rounded-2xl bg-secondary/60 p-3">
                    {facts.facts.map((fact, i) => (
                      <li
                        key={i}
                        className="flex gap-2 text-sm leading-relaxed text-secondary-foreground text-pretty"
                      >
                        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {facts?.error ? (
                  <p className="mt-2 text-sm text-muted-foreground">{facts.error}</p>
                ) : null}
              </div>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
