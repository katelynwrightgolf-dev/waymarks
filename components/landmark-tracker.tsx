"use client"

import { type CheckInInput, checkIn, deleteVisit, getVisits, updateNote } from "@/app/actions/visits"
import type { Visit } from "@/lib/db/schema"
import type { Landmark } from "@/lib/landmarks"
import {
  enqueueCheckIn,
  isNetworkError,
  pendingToVisit,
  readQueue,
  readVisitsCopy,
  removeQueued,
  saveVisitsCopy,
  updateQueuedNote,
  withPending,
} from "@/lib/offline-visits"
import { loadPlaces, nearbyPlaces, searchPlaces } from "@/lib/places"
import { PLACES_COUNT } from "@/lib/places-manifest"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudOff,
  Compass,
  Loader2,
  LocateFixed,
  MapPin,
  Plus,
  Search,
  X,
} from "lucide-react"
import dynamic from "next/dynamic"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  { label: "¼ mi", value: 400 },
  { label: "½ mi", value: 800 },
  { label: "1 mi", value: 1600 },
  { label: "5 mi", value: 8047 },
  { label: "10 mi", value: 16093 },
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
  const [radius, setRadius] = useState(800)
  const [landmarks, setLandmarks] = useState<Landmark[]>([])
  const [loadingLandmarks, setLoadingLandmarks] = useState(false)
  const [landmarkError, setLandmarkError] = useState<string | null>(null)
  const [tab, setTab] = useState<"nearby" | "visited">("nearby")
  const [listQuery, setListQuery] = useState("")
  const [nameResults, setNameResults] = useState<Landmark[]>([])
  const [nameSearching, setNameSearching] = useState(false)
  const [nameSearchedFor, setNameSearchedFor] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [who, setWho] = useState("Us")
  // Manual "log a marker I'm standing at" entry, for official markers that no
  // dataset (Wikipedia/OSM) knows about.
  const [addingMarker, setAddingMarker] = useState(false)
  const [markerName, setMarkerName] = useState("")
  const [markerNote, setMarkerNote] = useState("")
  const [savingMarker, setSavingMarker] = useState(false)
  // Re-open the full "Where are you?" card after a location is set.
  const [editingLocation, setEditingLocation] = useState(false)
  // "Logged ✓ — Undo" after a check-in, or a short notice.
  const [toast, setToast] = useState<
    { kind: "logged"; visitId: number; name: string; offline: boolean } | { kind: "notice"; text: string } | null
  >(null)
  // Offline places database: is it stored on this phone yet?
  const [placesStatus, setPlacesStatus] = useState<"loading" | "ready" | "missing">("loading")
  const [pendingCount, setPendingCount] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  // Ignore results from a superseded nearby lookup (location/radius changed).
  const loadSeq = useRef(0)
  const syncing = useRef(false)

  // Keep a copy of the log on the phone, and fold in check-ins still waiting
  // to sync. When the app was opened with no signal, the page itself may be an
  // older saved copy, so prefer the phone's newer copy of the log.
  useEffect(() => {
    const saved = !navigator.onLine ? readVisitsCopy() : null
    setVisits((prev) => withPending(saved ?? prev))
    setPendingCount(readQueue().length)
  }, [])
  useEffect(() => {
    saveVisitsCopy(visits)
  }, [visits])

  // Download the places database the first time (and keep it), so nearby
  // places work later with no service.
  useEffect(() => {
    loadPlaces()
      .then(() => setPlacesStatus("ready"))
      .catch(() => setPlacesStatus("missing"))
  }, [])

  // Send check-ins saved offline once there's a connection again.
  const syncPending = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return
    const queue = readQueue()
    if (!queue.length) return
    syncing.current = true
    let sent = 0
    try {
      for (const item of queue) {
        try {
          await checkIn(item.input)
          removeQueued(item.tempId)
          sent++
        } catch (err) {
          if (isNetworkError(err)) break
          // The server rejected it outright; drop it rather than retry forever.
          removeQueued(item.tempId)
        }
      }
      if (sent) setVisits(withPending(await getVisits()))
    } catch {
      // Lost signal mid-sync; the rest stays queued for next time.
    } finally {
      syncing.current = false
      setPendingCount(readQueue().length)
    }
  }, [])

  useEffect(() => {
    void syncPending()
    const onVisible = () => document.visibilityState === "visible" && void syncPending()
    window.addEventListener("online", syncPending)
    document.addEventListener("visibilitychange", onVisible)
    const timer = setInterval(() => void syncPending(), 30_000)
    return () => {
      window.removeEventListener("online", syncPending)
      document.removeEventListener("visibilitychange", onVisible)
      clearInterval(timer)
    }
  }, [syncPending])

  const visitedIds = useMemo(() => new Set(visits.map((v) => v.landmarkId)), [visits])
  const recentVisit = visits[0] ?? null

  // Every place we've logged, deduped by landmark id (a spot can be logged more
  // than once), shaped as Landmark[] so the map can pin them on the Visited tab.
  const visitedLandmarks = useMemo<Landmark[]>(() => {
    const seen = new Set<string>()
    const out: Landmark[] = []
    for (const v of visits) {
      if (seen.has(v.landmarkId)) continue
      seen.add(v.landmarkId)
      out.push({
        id: v.landmarkId,
        name: v.name,
        category: v.category,
        kind: "landmark",
        lat: v.lat,
        lng: v.lng,
        description: v.description,
        wikipedia: v.wikipedia,
        imageUrl: v.imageUrl,
      })
    }
    return out
  }, [visits])

  const filteredLandmarks = useMemo(() => {
    const q = listQuery.trim().toLowerCase()
    if (!q) return landmarks
    // Free-text filter on the names of the places found nearby.
    return landmarks.filter((l) => l.name.toLowerCase().includes(q))
  }, [landmarks, listQuery])

  // Stable [lat, lng] reference so the map only recenters when we actually move.
  const mapCenter = useMemo<[number, number] | null>(
    () => (position ? [position.lat, position.lng] : null),
    [position],
  )

  // Nearby places are National Register of Historic Places listings and
  // official Texas historical markers only, from the database stored on the
  // phone (lib/places.ts), so the list is the same with or without signal.
  const loadLandmarks = useCallback(async (lat: number, lng: number, r: number) => {
    const seq = ++loadSeq.current
    setLoadingLandmarks(true)
    setLandmarkError(null)
    try {
      const places = await nearbyPlaces(lat, lng, r)
      if (seq === loadSeq.current) setLandmarks(places)
    } catch {
      if (seq !== loadSeq.current) return
      setLandmarks([])
      setLandmarkError(
        navigator.onLine
          ? "Couldn't load the historic places list. Please try again."
          : "The historic places list isn't on this phone yet. Open Waymarks once with a signal to save it.",
      )
    } finally {
      if (seq === loadSeq.current) setLoadingLandmarks(false)
    }
  }, [])

  // Set the active location (from GPS or a manual search) and immediately load
  // its landmarks.
  const applyLocation = useCallback(
    (lat: number, lng: number, label: string) => {
      setPosition({ lat, lng })
      setLocationLabel(label)
      setGeoStatus("ready")
      setGeoError(null)
      setEditingLocation(false)
      void loadLandmarks(lat, lng, radius)
    },
    [loadLandmarks, radius],
  )

  const locate = useCallback(() => {
    setGeoStatus("locating")
    setGeoError(null)

    // Device GPS is the ONLY location source. We deliberately do not use
    // IP-based geolocation as a fallback: it's inaccurate and, behind a VPN or
    // on cellular, resolves to a routing hub far from where you actually are
    // (which is what put a Washington user in Atlanta). If GPS is unavailable
    // or denied, we ask the user to type their location instead — a search is
    // always correct, an IP guess often isn't.
    if (!("geolocation" in navigator)) {
      setGeoStatus("error")
      setGeoError("Your browser can't detect location. Search for where you are below.")
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => applyLocation(pos.coords.latitude, pos.coords.longitude, "Your current location"),
      // GPS denied, unavailable, or timed out (also covers the blocked preview
      // iframe) → guide the user to the manual search box.
      () => {
        setGeoStatus("error")
        setGeoError("Couldn't access your location. Search for where you are below instead.")
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  }, [applyLocation])

  // If location access was already granted, find nearby landmarks as soon as
  // the app opens instead of waiting for a tap. Never prompts on its own.
  useEffect(() => {
    let cancelled = false
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (!cancelled && status.state === "granted") locate()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Manual location: geocode a place name (city, town, landmark, or address)
  // through our server route so the app works even when device GPS is blocked
  // or denied (common inside preview iframes). The route tries multiple
  // geocoding providers so a real search reliably resolves.
  const searchLocation = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const name = query.trim()
      if (!name) return
      if (!navigator.onLine) {
        setGeoStatus("error")
        setGeoError("Town search needs a signal. Use your current location instead — GPS works without service.")
        return
      }
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

  // Search by NAME for a specific National Register site or Texas marker
  // anywhere, so you can log one even if it isn't in the nearby list.
  const searchByName = useCallback(async () => {
    const q = listQuery.trim()
    if (!q) return
    setNameSearching(true)
    setNameSearchedFor(q)
    try {
      setNameResults(await searchPlaces(q, position))
    } catch {
      setNameResults([])
    } finally {
      setNameSearching(false)
    }
  }, [listQuery, position])

  const clearNameSearch = useCallback(() => {
    setListQuery("")
    setNameResults([])
    setNameSearchedFor("")
  }, [])

  // Save a check-in: straight to the server with signal, otherwise onto the
  // phone to sync later. Returns false only if the server refused it.
  const saveCheckIn = useCallback(async (input: CheckInInput): Promise<boolean> => {
    if (navigator.onLine) {
      try {
        const row = await checkIn(input)
        setToast({ kind: "logged", visitId: row.id, name: input.name, offline: false })
        try {
          setVisits(withPending(await getVisits()))
        } catch {
          setVisits((prev) => withPending([row, ...prev]))
        }
        return true
      } catch (err) {
        if (!isNetworkError(err)) return false
      }
    }
    const pending = enqueueCheckIn(input)
    setVisits((prev) => [pendingToVisit(pending), ...prev])
    setPendingCount(readQueue().length)
    setToast({ kind: "logged", visitId: pending.tempId, name: input.name, offline: true })
    return true
  }, [])

  const handleCheckIn = useCallback(
    async (landmark: Landmark) => {
      setPendingId(landmark.id)
      const ok = await saveCheckIn({
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
      if (!ok) setLandmarkError("Couldn't save your check-in. Please try again.")
      setPendingId(null)
    },
    [who, saveCheckIn],
  )

  // Log a marker by hand at the current location. Uses a unique id so it never
  // collides with a dataset landmark, and pins it to wherever the user is now.
  const handleManualCheckIn = useCallback(async () => {
    if (!position) return
    const name = markerName.trim()
    if (!name) return
    setSavingMarker(true)
    const ok = await saveCheckIn({
      landmarkId: `manual/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      category: "Historical marker",
      description: null,
      lat: position.lat,
      lng: position.lng,
      note: markerNote.trim() || null,
      wikipedia: null,
      imageUrl: null,
      visitedBy: who,
    })
    if (ok) {
      setMarkerName("")
      setMarkerNote("")
      setAddingMarker(false)
      setTab("visited")
    } else {
      setLandmarkError("Couldn't save that marker. Please try again.")
    }
    setSavingMarker(false)
  }, [position, markerName, markerNote, who, saveCheckIn])

  const handleDelete = useCallback(async (id: number) => {
    const before = visits
    setVisits((prev) => prev.filter((v) => v.id !== id))
    if (id < 0) {
      // Still waiting to sync: just drop it from the phone.
      removeQueued(id)
      setPendingCount(readQueue().length)
      return
    }
    try {
      await deleteVisit(id)
    } catch (err) {
      setVisits(before)
      setToast({
        kind: "notice",
        text: isNetworkError(err) ? "No signal — try removing it again when you have service." : "Couldn't remove it.",
      })
    }
  }, [visits])

  // The toast fades on its own after a few seconds.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const undoCheckIn = useCallback(() => {
    if (toast?.kind !== "logged") return
    setToast(null)
    void handleDelete(toast.visitId)
  }, [toast, handleDelete])

  const handleSaveNote = useCallback(async (id: number, note: string) => {
    const before = visits
    setVisits((prev) => prev.map((v) => (v.id === id ? { ...v, note: note.trim() || null } : v)))
    if (id < 0) {
      updateQueuedNote(id, note)
      return
    }
    try {
      await updateNote(id, note)
    } catch (err) {
      setVisits(before)
      setToast({
        kind: "notice",
        text: isNetworkError(err) ? "No signal — your note wasn't saved. Try again with service." : "Couldn't save the note.",
      })
    }
  }, [visits])

  return (
    <div className="flex flex-col gap-5">
      {recentVisit ? <RecentVisit visit={recentVisit} /> : null}

      {/* Location. Once we know where you are, this collapses to a compact bar
          so the map and nearby list sit right under your thumb. */}
      {position && !editingLocation ? (
        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MapPin className="size-5" aria-hidden />
            </span>
            <button
              type="button"
              onClick={() => setEditingLocation(true)}
              aria-label="Change location"
              className="min-w-0 flex-1 rounded-xl text-left"
            >
              <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Exploring near
              </span>
              <span className="flex items-center gap-1 font-semibold text-card-foreground">
                <span className="truncate">{locationLabel ?? "Your location"}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </span>
            </button>
            <button
              type="button"
              onClick={locate}
              disabled={geoStatus === "locating"}
              aria-label="Update to my current location"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {geoStatus === "locating" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <LocateFixed className="size-4" aria-hidden />
              )}
            </button>
          </div>

          {geoError ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {geoError}
            </p>
          ) : null}

          <div className="mt-4 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Search radius
          </div>
          <div className="flex gap-1.5">
            {RADIUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => changeRadius(opt.value)}
                className={`min-h-10 flex-1 rounded-full border px-1 text-sm font-semibold transition-colors ${
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
        </section>
      ) : (
        <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
            <Compass className="size-5 text-primary" aria-hidden />
            <span className="flex-1">Where are you?</span>
            {position ? (
              <button
                type="button"
                onClick={() => setEditingLocation(false)}
                aria-label="Keep the current location"
                className="-my-2 -mr-2 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            We&apos;ll pull up historic buildings and landmarks around you.
          </p>

          <button
            type="button"
            onClick={locate}
            disabled={geoStatus === "locating"}
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {geoStatus === "locating" && !searching ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <LocateFixed className="size-5" aria-hidden />
            )}
            {geoStatus === "locating" && !searching ? "Finding you…" : "Use my current location"}
          </button>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">or search a place</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={searchLocation} className="flex gap-2">
            <div className="relative min-w-0 flex-1">
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
                aria-label="Enter a city or town"
                className="min-h-12 w-full rounded-full border border-border bg-background pr-4 pl-10 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={searching || !query.trim()}
              aria-label="Find landmarks here"
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-primary px-5 text-base font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              {searching ? <Loader2 className="size-5 animate-spin" aria-hidden /> : "Go"}
            </button>
          </form>

          {geoError ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {geoError}
            </p>
          ) : null}
        </section>
      )}

      {/* Map — pins for nearby results, or every place we've visited. */}
      {tab === "visited" ? (
        visitedLandmarks.length > 0 ? (
          <div className="h-72 overflow-hidden rounded-3xl border border-border">
            <MapView
              key="visited-map"
              center={[visitedLandmarks[0].lat, visitedLandmarks[0].lng]}
              landmarks={visitedLandmarks}
              visitedIds={visitedIds}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showMe={false}
              fitToLandmarks
            />
          </div>
        ) : null
      ) : mapCenter ? (
        <div className="h-72 overflow-hidden rounded-3xl border border-border">
          <MapView
            key="nearby-map"
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
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void searchByName()
              }}
              className="relative"
            >
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="text"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                enterKeyHint="search"
                placeholder="Search a landmark by name"
                aria-label="Search landmarks by name"
                className="min-h-11 w-full rounded-full border border-border bg-background pr-10 pl-9 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {listQuery ? (
                <button
                  type="button"
                  onClick={clearNameSearch}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </form>
            {filteredLandmarks.length === 0 && listQuery.trim() ? (
              <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Nothing nearby matches &ldquo;{listQuery.trim()}&rdquo;.
              </p>
            ) : (
              <NearbyList
                landmarks={filteredLandmarks}
                visitedIds={visitedIds}
                selectedId={selectedId}
                pendingId={pendingId}
                onSelect={setSelectedId}
                onCheckIn={handleCheckIn}
                locationLabel={locationLabel}
              />
            )}

            {/* Walking past something not in the list? Search everywhere by name. */}
            {listQuery.trim() ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/40 p-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Not in the list? Search every National Register site and Texas historical marker by name and log it
                  directly.
                </p>
                <button
                  type="button"
                  onClick={() => void searchByName()}
                  disabled={nameSearching}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {nameSearching ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Search className="size-4" aria-hidden />
                  )}
                  Search everywhere for &ldquo;{listQuery.trim()}&rdquo;
                </button>

                {!nameSearching && nameSearchedFor ? (
                  nameResults.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Results for &ldquo;{nameSearchedFor}&rdquo;
                      </p>
                      <NearbyList
                        landmarks={nameResults}
                        visitedIds={visitedIds}
                        selectedId={selectedId}
                        pendingId={pendingId}
                        onSelect={setSelectedId}
                        onCheckIn={handleCheckIn}
                      />
                    </div>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground">
                      No landmark named &ldquo;{nameSearchedFor}&rdquo; found. Try a different spelling.
                    </p>
                  )
                ) : null}
              </div>
            ) : null}

            {/* Escape hatch for the many official roadside markers that aren't
                in Wikipedia or OpenStreetMap: log the one in front of you by
                hand, pinned to your current location. */}
            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-4">
              <div>
                <p className="text-sm font-semibold text-card-foreground">
                  Standing at a marker that isn&apos;t listed?
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Official roadside markers often aren&apos;t in any map database. Log the one in front of you at your
                  current location.
                </p>
              </div>

              {addingMarker ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={markerName}
                    onChange={(e) => setMarkerName(e.target.value)}
                    placeholder="What the marker says or commemorates"
                    aria-label="Marker name"
                    className="min-h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                  <textarea
                    value={markerNote}
                    onChange={(e) => setMarkerNote(e.target.value)}
                    placeholder="Add a note (optional)"
                    aria-label="Note about this marker"
                    rows={2}
                    className="w-full rounded-xl border border-border bg-background p-3 text-base leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAddingMarker(false)}
                      className="min-h-11 flex-1 rounded-full border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleManualCheckIn()}
                      disabled={savingMarker || !markerName.trim()}
                      className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {savingMarker ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Check className="size-4" aria-hidden />
                      )}
                      Log this marker
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMarkerName(listQuery.trim())
                    setAddingMarker(true)
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-primary px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  <Plus className="size-4" aria-hidden />
                  Add a marker here
                </button>
              )}
            </div>
          </div>
        )
      ) : (
        <VisitLog visits={visits} onDelete={handleDelete} onSaveNote={handleSaveNote} />
      )}

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        {placesStatus === "ready" ? (
          <>
            <CloudOff className="size-3.5" aria-hidden />
            {PLACES_COUNT.toLocaleString()} historic places saved for no-signal use
          </>
        ) : placesStatus === "loading" ? (
          "Saving historic places for no-signal use…"
        ) : (
          "Open Waymarks once with a signal to save historic places for no-signal use."
        )}
        {pendingCount ? ` · ${pendingCount} check-in${pendingCount === 1 ? "" : "s"} waiting for signal` : ""}
      </p>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1100] flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div
            role="status"
            className="waymarks-toast pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-[oklch(0.27_0.028_47)] py-2 pr-2 pl-4 text-[oklch(0.97_0.014_83)] shadow-xl"
          >
            {toast.kind === "logged" ? (
              <>
                {toast.offline ? (
                  <CloudOff className="size-5 shrink-0 text-[oklch(0.8_0.11_72)]" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-5 shrink-0 text-[oklch(0.8_0.11_72)]" aria-hidden />
                )}
                <p className="min-w-0 flex-1 text-sm">
                  <span className="block truncate">
                    {toast.offline ? "Saved" : "Logged"} <span className="font-semibold">{toast.name}</span>
                  </span>
                  {toast.offline ? (
                    <span className="block text-xs opacity-75">No signal — it&apos;ll sync when you&apos;re back in range</span>
                  ) : null}
                </p>
                <button
                  type="button"
                  onClick={undoCheckIn}
                  className="inline-flex min-h-10 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-[oklch(0.8_0.11_72)] transition-colors hover:bg-white/10"
                >
                  Undo
                </button>
              </>
            ) : (
              <p className="min-w-0 flex-1 py-2 pr-2 text-sm">{toast.text}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
