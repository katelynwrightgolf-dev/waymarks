import { NextResponse } from "next/server"

// Turn a place name (e.g. "Washington DC", "Faneuil Hall") into coordinates
// using OpenStreetMap's Nominatim geocoder. This is the reliable fallback for
// when device GPS is blocked or unavailable (common inside preview iframes).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim()

  if (!q) {
    return NextResponse.json({ error: "Missing search query" }, { status: 400 })
  }

  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q,
      format: "json",
      addressdetails: "1",
      limit: "5",
      countrycodes: "us",
    })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(url, {
      headers: {
        // Nominatim requires a descriptive User-Agent or it returns 403.
        "User-Agent": "Waymarks/1.0 (historic landmark tracker)",
        "Accept-Language": "en",
      },
      signal: controller.signal,
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      return NextResponse.json({ error: "Location search failed" }, { status: 502 })
    }

    const raw = (await res.json()) as Array<{
      lat: string
      lon: string
      display_name: string
    }>

    const results = raw.map((r) => ({
      lat: Number.parseFloat(r.lat),
      lng: Number.parseFloat(r.lon),
      label: r.display_name,
    }))

    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ error: "Location search timed out" }, { status: 504 })
  } finally {
    clearTimeout(timer)
  }
}
