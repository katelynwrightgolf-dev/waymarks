"use client"

import { checkIn, deleteVisit, getVisits, updateNote } from "@/app/actions/visits"
import type { Visit } from "@/lib/db/schema"
import type { Landmark } from "@/lib/landmarks"
import { AlertTriangle, Compass, Loader2, LocateFixed, MapPin, Search } from "lucide-react"
import dynamic from "next/dynamic"
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react"
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
  const [kindFilter, setKindFilter] = useState<"all" | "landmark" | "town">("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [who, setWho] = useState("Us")
  const [approximate, setApproximate] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const focusSearch = useCallback(() => {
    searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    searchRef.current?.focus()
  }, [])

  const visitedIds = useMemo(() => new Set(visits.map((v) => v.landmarkId)), [visits])
  const recentVisit = visits[0] ?? null

  // Split results into towns vs. individual landmarks so we can filter/count.
  const townCount = useMemo(() => landmarks.filter((l) => l.kind === "town").length, [landmarks])
  const landmarkCount = landmarks.length - townCount
  const filteredLandmarks = useMemo(
    () => (kindFilter === "all" ? landmarks : landmarks.filter((l) => l.kind === kindFilter)),
    [landmarks, kindFilter],
  )

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

  // Set the active location and immediately load its landmarks. `isApprox`
  // marks IP-based estimates so we can prompt the user to refine by search.
  const applyLocation = useCallback(
    (lat: number, lng: number, label: string, isApprox = false) => {
      setPosition({ lat, lng })
      setLocationLabel(label)
      setApproximate(isApprox)
      setGeoStatus("ready")
      setGeoError(null)
      void loadLandmarks(lat, lng, radius)
    },
    [loadLandmarks, radius],
  )

  // Approximate location via our SERVER route. Doing this server-side avoids
  // the cross-origin iframe restrictions that block browser geolocation and
  // client-side IP lookups inside the preview, so auto-detect actually works.
  const locateByIp = useCallback(async () => {
    try {
      const res = await fetch("/api/my-location")
      if (!res.ok) return false
      const data = await res.json()
      if (typeof data.lat === "number" && typeof data.lng === "number") {
        applyLocation(data.lat, data.lng, data.label || "Approximate location", true)
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

    // Whoever provides a usable position first wins. GPS is preferred when it
    // works (most accurate), but inside the preview iframe it's usually blocked
    // or hangs — so we run the server-side estimate in parallel and show it as
    // soon as it's ready instead of leaving you stuck on a spinner.
    let gpsApplied = false
    let anyApplied = false

    const apply = (lat: number, lng: number, label: string, fromGps: boolean) => {
      // Don't let a slower IP estimate overwrite a good GPS fix.
      if (!fromGps && gpsApplied) return
      if (fromGps) gpsApplied = true
      anyApplied = true
      applyLocation(lat, lng, label)
    }

    // Kick off the server-side estimate immediately (works in the iframe).
    const ipPromise = locateByIp().then((ok) => ok)

    if (!("geolocation" in navigator)) {
      void ipPromise.then((ok) => {
        if (!ok && !anyApplied) {
          setGeoStatus("error")
          setGeoError("Couldn't detect your location automatically. Search for where you are below.")
        }
      })
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => apply(pos.coords.latitude, pos.coords.longitude, "Your current location", true),
      async () => {
        // GPS blocked/failed → make sure the IP estimate had its chance before
        // showing an error, then guide to manual search.
        const ok = await ipPromise
        if (!ok && !anyApplied) {
          setGeoStatus("error")
          setGeoError("Location access is blocked here. Search for where you are below instead.")
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
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
          Where are you?
        </div>

        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Type your city or town to see historic landmarks around it.
        </p>

        <form onSubmit={searchLocation} className="mt-3 flex flex-col gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              enterKeyHint="search"
              placeholder="e.g. Olympia, WA"
              aria-label="Enter your city or town"
              className="min-h-12 w-full rounded-full border border-border bg-background pr-4 pl-10 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {searching ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Search className="size-5" aria-hidden />
            )}
            Find landmarks here
          </button>
        </form>

        <div className="my-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={locate}
          disabled={geoStatus === "locating"}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-border px-5 text-base font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {geoStatus === "locating" ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <LocateFixed className="size-5" aria-hidden />
          )}
          Use my phone&apos;s GPS
        </button>
        <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
          GPS finds you automatically on the published app. In this preview it&apos;s only a rough guess, so searching your town is more reliable.
        </p>

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
            {approximate ? (
              <div className="mb-3 flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/15 p-3 text-sm text-accent-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium">This is an approximate location.</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Not where you are? {" "}
                    <button
                      type="button"
                      onClick={focusSearch}
                      className="font-semibold text-primary underline underline-offset-2"
                    >
                      Search your town
                    </button>{" "}
                    to set it exactly.
                  </p>
                </div>
              </div>
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
            landmarks={filteredLandmarks}
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
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              {(
                [
                  { key: "all", label: `All (${landmarks.length})` },
                  { key: "landmark", label: `Landmarks (${landmarkCount})` },
                  { key: "town", label: `Towns (${townCount})` },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setKindFilter(opt.key)}
                  className={`min-h-10 flex-1 rounded-full border px-3 text-sm font-semibold transition-colors ${
                    kindFilter === opt.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <NearbyList
              landmarks={filteredLandmarks}
              visitedIds={visitedIds}
              selectedId={selectedId}
              pendingId={pendingId}
              onSelect={setSelectedId}
              onCheckIn={handleCheckIn}
            />
          </div>
        )
      ) : (
        <VisitLog visits={visits} onDelete={handleDelete} onSaveNote={handleSaveNote} />
      )}
    </div>
  )
}
