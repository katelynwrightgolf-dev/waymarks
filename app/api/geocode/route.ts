import { NextResponse } from "next/server"

type GeoResult = { lat: number; lng: number; label: string }

// Provider 1: Open-Meteo geocoding — fast, no key, no rate limits, great for
// cities and towns. Returns rich place data.
async function fromOpenMeteo(q: string, signal: AbortSignal): Promise<GeoResult[]> {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({ name: q, count: "5", language: "en", format: "json" })
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
  return (data.results ?? [])
    .filter((r) => !r.country_code || r.country_code === "US")
    .map((r) => ({
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
    new URLSearchParams({ q, format: "json", addressdetails: "0", limit: "5", countrycodes: "us" })
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
  const raw = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
  return raw.map((r) => ({
    lat: Number.parseFloat(r.lat),
    lng: Number.parseFloat(r.lon),
    label: r.display_name,
  }))
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
