"use client"

import { checkIn, deleteVisit, getVisits, updateNote } from "@/app/actions/visits"
import type { Visit } from "@/lib/db/schema"
import type { Landmark } from "@/lib/landmarks"
import { AlertTriangle, Compass, Loader2, LocateFixed, MapPin, Search } from "lucide-react"
import dynamic from "next/dynamic"
import { type FormEvent, useCallback, useMemo, useState } from "react"
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

type GeoResult = { lat: number; lng: number; label: string }

export function LandmarkTracker({ initialVisits }: { initialVisits: Visit[] }) {
  const [visits, setVisits] = useState<Visit[]>(initialVisits)
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle")
  const [geoError, setGeoError] = useState<string | null>(null)
  const [locationLabel, setLocationLabel] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
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

  // Stable [lat, lng] reference so the map only recenters when we actually move.
  const mapCenter = useMemo<[number, number] | null>(
    () => (position ? [position.lat, position.lng] : null),
    [position],
  )

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

  // Set the active location and immediately load its landmarks.
  const applyLocation = useCallback(
    (lat: number, lng: number, label: string) => {
      setPosition({ lat, lng })
      setLocationLabel(label)
      setGeoStatus("ready")
      setGeoError(null)
      void loadLandmarks(lat, lng, radius)
    },
    [loadLandmarks, radius],
  )

  // Approximate location from the network — works even when GPS is blocked or
  // unavailable, which is common inside embedded browser previews and iframes.
  const locateByIp = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      const res = await fetch("https://ipwho.is/", { signal: controller.signal })
      clearTimeout(timer)
      const data = await res.json()
      if (data && data.success !== false && typeof data.latitude === "number") {
        const place = [data.city, data.region].filter(Boolean).join(", ")
        applyLocation(data.latitude, data.longitude, place ? `${place} (approx.)` : "Approx. location")
        return true
      }
    } catch {
      /* fall through to the manual search */
    }
    return false
  }, [applyLocation])

  const locate = useCallback(() => {
    setGeoStatus("locating")
    setGeoError(null)

    // No GPS support at all → go straight to the network-based estimate.
    if (!("geolocation" in navigator)) {
      void locateByIp().then((ok) => {
        if (!ok) {
          setGeoStatus("error")
          setGeoError("Couldn't detect your location. Search for a city below instead.")
        }
      })
      return
    }

    let settled = false

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        settled = true
        applyLocation(pos.coords.latitude, pos.coords.longitude, "Your current location")

        // Quietly refine with a precise GPS fix in the background.
        navigator.geolocation.getCurrentPosition(
          (precise) => {
            const moved =
              Math.abs(precise.coords.latitude - pos.coords.latitude) > 0.0015 ||
              Math.abs(precise.coords.longitude - pos.coords.longitude) > 0.0015
            if (moved)
              applyLocation(precise.coords.latitude, precise.coords.longitude, "Your current location")
          },
          () => {
            /* keep the fast fix if the precise lookup fails */
          },
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
        )
      },
      async (err) => {
        if (settled) return
        // GPS denied/blocked/failed → automatically fall back to a network
        // estimate so the app still works instead of leaving you stuck.
        const ok = await locateByIp()
        if (!ok) {
          setGeoStatus("error")
          setGeoError(
            err.code === err.PERMISSION_DENIED
              ? "Location access is blocked here. Search for a city below to explore landmarks."
              : "Couldn't get your location. Search for a city below instead.",
          )
        }
      },
      // Accept a fast, slightly stale low-accuracy fix, then refine above.
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    )
  }, [applyLocation, locateByIp])

  // Manual location: geocode a place name (city, town, landmark, or address)
  // through our server route so the app works even when device GPS is blocked
  // or denied (common inside preview iframes). The route tries multiple
  // geocoding providers so a real search reliably resolves.
  const searchLocation = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const name = query.trim()
      if (!name) return
      setSearching(true)
      setGeoStatus("locating")
      setGeoError(null)
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(name)}`)
        const data = await res.json()
        if (!res.ok || !data.results?.length) {
          throw new Error(data.error || `We couldn't find "${name}". Try a nearby city or town.`)
        }
        const top = data.results[0] as GeoResult
        applyLocation(top.lat, top.lng, top.label)
      } catch (err) {
        setGeoStatus("error")
        setGeoError(err instanceof Error ? err.message : "Location search failed. Please try again.")
      } finally {
        setSearching(false)
      }
    },
    [query, applyLocation],
  )

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
          imageUrl: landmark.imageUrl,
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

        <form onSubmit={searchLocation} className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              enterKeyHint="search"
              placeholder="Or search a city or town"
              aria-label="Search for a city or town"
              className="min-h-12 w-full rounded-full border border-border bg-background pr-4 pl-9 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {searching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Search"}
          </button>
        </form>

        {geoError ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {geoError}
          </p>
        ) : null}

        {position ? (
          <div className="mt-4">
            {locationLabel ? (
              <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-card-foreground">
                <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
                {locationLabel}
              </p>
            ) : null}
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
            Tap above, or search a city, and we&apos;ll pull up historic buildings and landmarks near that spot.
          </p>
        )}
      </section>

      {/* Map */}
      {mapCenter ? (
        <div className="h-72 overflow-hidden rounded-3xl border border-border">
          <MapView
            center={mapCenter}
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
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Finding historic landmarks nearby…
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4"
                aria-hidden
              >
                <div className="size-11 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : landmarkError ? (
          <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {landmarkError}
          </p>
        ) : !position ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Use your location or search a city to discover historic landmarks nearby.
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
