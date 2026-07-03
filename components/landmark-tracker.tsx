"use client"

import { checkIn, deleteVisit, getVisits, updateNote } from "@/app/actions/visits"
import type { Visit } from "@/lib/db/schema"
import type { Landmark } from "@/lib/landmarks"
import { AlertTriangle, Compass, Loader2, LocateFixed } from "lucide-react"
import dynamic from "next/dynamic"
import { useCallback, useMemo, useState } from "react"
import { NearbyList } from "./nearby-list"
import { RecentVisit } from "./recent-visit"
import { VisitLog } from "./visit-log"

const MapView = dynamic(() => import("./map-view"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

const RADIUS_OPTIONS = [
  { label: "1 mi", value: 1600 },
  { label: "3 mi", value: 4800 },
  { label: "6 mi", value: 9700 },
]

const WHO_OPTIONS = ["Us", "Me", "Matt"]

type GeoStatus = "idle" | "locating" | "ready" | "error"

export function LandmarkTracker({ initialVisits }: { initialVisits: Visit[] }) {
  const [visits, setVisits] = useState<Visit[]>(initialVisits)
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle")
  const [geoError, setGeoError] = useState<string | null>(null)
  const [radius, setRadius] = useState(4800)
  const [landmarks, setLandmarks] = useState<Landmark[]>([])
  const [loadingLandmarks, setLoadingLandmarks] = useState(false)
  const [landmarkError, setLandmarkError] = useState<string | null>(null)
  const [tab, setTab] = useState<"nearby" | "visited">("nearby")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [who, setWho] = useState("Us")

  const visitedIds = useMemo(() => new Set(visits.map((v) => v.landmarkId)), [visits])
  const recentVisit = visits[0] ?? null

  const loadLandmarks = useCallback(async (lat: number, lng: number, r: number) => {
    setLoadingLandmarks(true)
    setLandmarkError(null)
    try {
      const res = await fetch(`/api/landmarks?lat=${lat}&lng=${lng}&radius=${r}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to load landmarks")
      setLandmarks(data.landmarks as Landmark[])
    } catch (err) {
      setLandmarkError(err instanceof Error ? err.message : "Something went wrong")
      setLandmarks([])
    } finally {
      setLoadingLandmarks(false)
    }
  }, [])

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeoStatus("error")
      setGeoError("Your device doesn't support location.")
      return
    }
    setGeoStatus("locating")
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setPosition(coords)
        setGeoStatus("ready")
        void loadLandmarks(coords.lat, coords.lng, radius)
      },
      (err) => {
        setGeoStatus("error")
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Enable it in your browser to find nearby landmarks."
            : "Couldn't get your location. Please try again.",
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }, [loadLandmarks, radius])

  const changeRadius = useCallback(
    (value: number) => {
      setRadius(value)
      if (position) void loadLandmarks(position.lat, position.lng, value)
    },
    [position, loadLandmarks],
  )

  const handleCheckIn = useCallback(
    async (landmark: Landmark) => {
      setPendingId(landmark.id)
      try {
        await checkIn({
          landmarkId: landmark.id,
          name: landmark.name,
          description: landmark.description,
          category: landmark.category,
          lat: landmark.lat,
          lng: landmark.lng,
          wikipedia: landmark.wikipedia,
          visitedBy: who,
        })
        const fresh = await getVisits()
        setVisits(fresh)
      } catch {
        setLandmarkError("Couldn't save your check-in. Please try again.")
      } finally {
        setPendingId(null)
      }
    },
    [who],
  )

  const handleDelete = useCallback(async (id: number) => {
    setVisits((prev) => prev.filter((v) => v.id !== id))
    await deleteVisit(id)
  }, [])

  const handleSaveNote = useCallback(async (id: number, note: string) => {
    setVisits((prev) => prev.map((v) => (v.id === id ? { ...v, note: note.trim() || null } : v)))
    await updateNote(id, note)
  }, [])

  return (
    <div className="flex flex-col gap-5">
      {recentVisit ? <RecentVisit visit={recentVisit} /> : null}

      {/* Location controls */}
      <section className="rounded-3xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
          <Compass className="size-5 text-primary" aria-hidden />
          Find landmarks around you
        </div>

        <button
          type="button"
          onClick={locate}
          disabled={geoStatus === "locating"}
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {geoStatus === "locating" ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <LocateFixed className="size-5" aria-hidden />
          )}
          {geoStatus === "ready" ? "Update my location" : "Use my current location"}
        </button>

        {geoError ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {geoError}
          </p>
        ) : null}

        {position ? (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Search radius
            </div>
            <div className="flex gap-2">
              {RADIUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => changeRadius(opt.value)}
                  className={`min-h-10 flex-1 rounded-full border px-3 text-sm font-semibold transition-colors ${
                    radius === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="mt-4 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Logging as
            </div>
            <div className="flex gap-2">
              {WHO_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setWho(option)}
                  className={`min-h-10 flex-1 rounded-full border px-3 text-sm font-semibold transition-colors ${
                    who === option
                      ? "border-accent bg-accent/25 text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Tap above and we&apos;ll pull historic buildings and landmarks from OpenStreetMap right where you are.
          </p>
        )}
      </section>

      {/* Map */}
      {position ? (
        <div className="h-72 overflow-hidden rounded-3xl border border-border">
          <MapView
            center={[position.lat, position.lng]}
            landmarks={landmarks}
            visitedIds={visitedIds}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              setTab("nearby")
            }}
          />
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-2 rounded-full bg-muted p-1">
        <button
          type="button"
          onClick={() => setTab("nearby")}
          className={`min-h-11 flex-1 rounded-full text-sm font-semibold transition-colors ${
            tab === "nearby" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          Nearby{landmarks.length ? ` (${landmarks.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setTab("visited")}
          className={`min-h-11 flex-1 rounded-full text-sm font-semibold transition-colors ${
            tab === "visited" ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          Visited{visits.length ? ` (${visits.length})` : ""}
        </button>
      </div>

      {tab === "nearby" ? (
        loadingLandmarks ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Searching OpenStreetMap…
          </div>
        ) : landmarkError ? (
          <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {landmarkError}
          </p>
        ) : !position ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Share your location to discover historic landmarks nearby.
          </p>
        ) : (
          <NearbyList
            landmarks={landmarks}
            visitedIds={visitedIds}
            selectedId={selectedId}
            pendingId={pendingId}
            onSelect={setSelectedId}
            onCheckIn={handleCheckIn}
          />
        )
      ) : (
        <VisitLog visits={visits} onDelete={handleDelete} onSaveNote={handleSaveNote} />
      )}
    </div>
  )
}
