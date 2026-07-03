"use client"

import type { Visit } from "@/lib/db/schema"
import { wikipediaUrl } from "@/lib/landmarks"
import { fullDate } from "@/lib/time"
import { ExternalLink, MapPin, Pencil, Trash2, X } from "lucide-react"
import { useState } from "react"

type VisitLogProps = {
  visits: Visit[]
  onDelete: (id: number) => void
  onSaveNote: (id: number, note: string) => void
}

export function VisitLog({ visits, onDelete, onSaveNote }: VisitLogProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState("")

  if (visits.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No landmarks logged yet. When you pass one, tap &ldquo;I was by this&rdquo; to remember it here.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {visits.map((visit) => {
        const wiki = wikipediaUrl(visit.wikipedia)
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${visit.lat},${visit.lng}`
        const editing = editingId === visit.id

        return (
          <li key={visit.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-serif text-lg leading-snug text-card-foreground text-pretty">
                  {visit.name}
                </h3>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {visit.category ? <span>{visit.category}</span> : null}
                  <span aria-hidden>·</span>
                  <span>{fullDate(visit.visitedAt)}</span>
                  <span aria-hidden>·</span>
                  <span>{visit.visitedBy}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDelete(visit.id)}
                aria-label={`Remove ${visit.name} from log`}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
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
  )
}
