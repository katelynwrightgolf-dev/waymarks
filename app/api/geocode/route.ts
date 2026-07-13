import { NextResponse } from "next/server"

type GeoResult = { lat: number; lng: number; label: string }

// Map of US state abbreviations → full names so we can detect and strip a
// trailing state from a query (e.g. "Walla Walla WA") and use it to pick the
// right result. Open-Meteo doesn't understand the "WA" suffix, so we split it.
const US_STATES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California",
  co: "Colorado", ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia",
  hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland",
  ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi", mo: "Missouri",
  mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey",
  nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio",
  ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina",
  sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont",
  va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
  dc: "District of Columbia",
}

// Split a query into a bare place name and (optionally) a US state, accepting
// either "Olympia, WA" / "Olympia WA" / "Olympia, Washington".
function splitState(q: string): { name: string; state?: string } {
  const parts = q.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1].toLowerCase()
    const state = US_STATES[tail] || Object.values(US_STATES).find((s) => s.toLowerCase() === tail)
    if (state) return { name: parts.slice(0, -1).join(", "), state }
  }
  // No comma: check for a trailing 2-letter state code, e.g. "Walla Walla WA".
  const m = q.match(/^(.*?)[\s]+([A-Za-z]{2})$/)
  if (m && US_STATES[m[2].toLowerCase()]) {
    return { name: m[1].trim(), state: US_STATES[m[2].toLowerCase()] }
  }
  return { name: q }
}

// Provider 1: Open-Meteo geocoding — fast, no key, no rate limits, great for
// cities and towns. Returns clean settlement centers (not county centroids).
async function fromOpenMeteo(q: string, signal: AbortSignal): Promise<GeoResult[]> {
  const { name, state } = splitState(q)
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({ name, count: "10", language: "en", format: "json" })
  const res = await fetch(url, { signal, next: { revalidate: 3600 } })
  if (!res.ok) return []
  const data = (await res.json()) as {
    results?: Array<{
      latitude: number
      longitude: number
      name: string
      admin1?: string
      country_code?: string
    }>
  }
  let results = (data.results ?? []).filter((r) => !r.country_code || r.country_code === "US")
  // If the user named a state, keep only matches in that state.
  if (state) {
    const inState = results.filter((r) => r.admin1?.toLowerCase() === state.toLowerCase())
    if (inState.length) results = inState
  }
  return results.map((r) => ({
    lat: r.latitude,
    lng: r.longitude,
    label: [r.name, r.admin1].filter(Boolean).join(", "),
  }))
}

// Provider 2: OpenStreetMap Nominatim — handles landmarks, neighborhoods, and
// full addresses that Open-Meteo can't. Used as a fallback.
async function fromNominatim(q: string, signal: AbortSignal): Promise<GeoResult[]> {
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q, format: "json", addressdetails: "0", limit: "10", countrycodes: "us" })
  const res = await fetch(url, {
    headers: {
      // Nominatim requires a descriptive User-Agent or it returns 403.
      "User-Agent": "Waymarks/1.0 (historic landmark tracker; contact via app)",
      "Accept-Language": "en",
    },
    signal,
    next: { revalidate: 3600 },
  })
  if (!res.ok) return []
  const raw = (await res.json()) as Array<{
    lat: string
    lon: string
    display_name: string
    class?: string
    type?: string
    importance?: number
  }>

  // Prefer actual settlements (city/town/village) over county/state boundaries
  // so "Walla Walla WA" resolves to the town center — where landmarks are —
  // instead of the rural county centroid.
  const settlementTypes = new Set(["city", "town", "village", "hamlet", "municipality"])
  const rank = (r: { class?: string; type?: string }) => {
    if (r.class === "place" && settlementTypes.has(r.type ?? "")) return 0
    if (r.class === "place") return 1
    if (r.class === "boundary" && r.type === "administrative") return 3
    return 2
  }
  return raw
    .map((r) => ({
      lat: Number.parseFloat(r.lat),
      lng: Number.parseFloat(r.lon),
      label: r.display_name,
      _rank: rank(r),
      _imp: r.importance ?? 0,
    }))
    .sort((a, b) => a._rank - b._rank || b._imp - a._imp)
    .map(({ lat, lng, label }) => ({ lat, lng, label }))
}

// Turn a place name (city, town, landmark, or address) into coordinates. We try
// Open-Meteo first, then fall back to Nominatim, so a real device can always
// find its location even when GPS is blocked inside a preview iframe.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim()

  if (!q) {
    return NextResponse.json({ error: "Please type where you are." }, { status: 400 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    let results: GeoResult[] = []
    try {
      results = await fromOpenMeteo(q, controller.signal)
    } catch {
      /* try the fallback provider */
    }

    if (results.length === 0) {
      try {
        results = await fromNominatim(q, controller.signal)
      } catch {
        /* handled below */
      }
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: `We couldn't find "${q}". Try a nearby city or town.` },
        { status: 404 },
      )
    }

    return NextResponse.json({ results })
  } finally {
    clearTimeout(timer)
  }
}
