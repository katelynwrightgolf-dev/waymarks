"use client"

import type { Visit } from "@/lib/db/schema"
import { wikipediaUrl } from "@/lib/landmarks"
import { placeInfoUrl } from "@/lib/places"
import { dayKey, dayLabel, timeOfDay } from "@/lib/time"
import { CloudOff, ExternalLink, MapPin, Pencil, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

type VisitLogProps = {
  visits: Visit[]
  onDelete: (id: number) => void
  onSaveNote: (id: number, note: string) => void
}

export function VisitLog({ visits, onDelete, onSaveNote }: VisitLogProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  // Deleting takes two taps (trash, then "Remove?") so a stray tap in a moving
  // car can't erase a memory. The confirm state quietly resets after a moment.
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  useEffect(() => {
    if (confirmingId === null) return
    const t = setTimeout(() => setConfirmingId(null), 3500)
    return () => clearTimeout(t)
  }, [confirmingId])

  // Visits arrive newest-first; group consecutive ones by local calendar day.
  const days = useMemo(() => {
    const groups: { key: string; label: string; visits: Visit[] }[] = []
    for (const visit of visits) {
      const key = dayKey(visit.visitedAt)
      const last = groups[groups.length - 1]
      if (last?.key === key) last.visits.push(visit)
      else groups.push({ key, label: dayLabel(visit.visitedAt), visits: [visit] })
    }
    return groups
  }, [visits])

  if (visits.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No landmarks logged yet. When you pass one, tap &ldquo;I was by this&rdquo; to remember it here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label} className="flex flex-col gap-3">
          <h3 className="flex items-baseline gap-2 px-1">
            <span className="font-serif text-lg font-semibold text-foreground">{day.label}</span>
            <span className="text-xs font-medium text-muted-foreground">
              {day.visits.length} {day.visits.length === 1 ? "stop" : "stops"}
            </span>
          </h3>
          <ul className="flex flex-col gap-3">
            {day.visits.map((visit) => {
              const wiki = wikipediaUrl(visit.wikipedia) ?? placeInfoUrl(visit.landmarkId)
              const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${visit.lat},${visit.lng}`
              const editing = editingId === visit.id
              const confirming = confirmingId === visit.id

              return (
                <li key={visit.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    {visit.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={visit.imageUrl || "/placeholder.svg"}
                        alt={visit.name}
                        loading="lazy"
                        className="size-14 shrink-0 rounded-xl object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-serif text-lg leading-snug text-card-foreground text-pretty">
                        {visit.name}
                      </h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {visit.category ? <span>{visit.category}</span> : null}
                        {visit.category ? <span aria-hidden>·</span> : null}
                        <span>{timeOfDay(visit.visitedAt)}</span>
                    {visit.id < 0 ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/25 px-1.5 font-medium text-accent-foreground">
                          <CloudOff className="size-3" aria-hidden />
                          Waiting for signal
                        </span>
                      </>
                    ) : null}
                        <span aria-hidden>·</span>
                        <span>{visit.visitedBy}</span>
                      </div>
                      {visit.description ? (
                        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground text-pretty">
                          {visit.description}
                        </p>
                      ) : null}
                    </div>
                    {confirming ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingId(null)
                          onDelete(visit.id)
                        }}
                        aria-label={`Confirm removing ${visit.name} from log`}
                        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-destructive px-3 text-xs font-semibold text-white"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        Remove?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(visit.id)}
                        aria-label={`Remove ${visit.name} from log`}
                        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>

                  {editing ? (
                    <div className="mt-3">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                        placeholder="Add a memory about this stop..."
                        className="w-full resize-none rounded-xl border border-input bg-background p-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onSaveNote(visit.id, draft)
                            setEditingId(null)
                          }}
                          className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
                        >
                          Save note
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-4 text-sm font-semibold"
                        >
                          <X className="size-4" aria-hidden />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : visit.note ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(visit.id)
                        setDraft(visit.note ?? "")
                      }}
                      className="mt-3 block w-full rounded-xl bg-muted p-3 text-left text-sm leading-relaxed text-foreground"
                    >
                      &ldquo;{visit.note}&rdquo;
                      <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Pencil className="size-3" aria-hidden />
                        Edit note
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(visit.id)
                        setDraft("")
                      }}
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      Add a memory
                    </button>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      <MapPin className="size-4" aria-hidden />
                      Map
                    </a>
                    {wiki ? (
                      <a
                        href={wiki}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="size-4" aria-hidden />
                        Read more
                      </a>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
