// Shared types + OpenStreetMap (Overpass API) helpers for discovering
// historic buildings and landmarks near a location.

export type Landmark = {
  id: string
  name: string
  category: string | null
  lat: number
  lng: number
  description: string | null
  wikipedia: string | null
  imageUrl: string | null
  distanceMeters?: number
}

type GeoSearchResult = {
  pageid: number
  title: string
  lat: number
  lon: number
  dist: number
}

type PageDetail = {
  pageid: number
  title: string
  extract?: string
  description?: string
  thumbnail?: { source: string }
  coordinates?: { lat: number; lon: number }[]
}

const WIKI_API = "https://en.wikipedia.org/w/api.php"

async function wikiFetch(params: Record<string, string>): Promise<any> {
  const url = `${WIKI_API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Waymarks/1.0 (historic landmark tracker)" },
      signal: controller.signal,
      // Cache identical lookups briefly to keep repeat searches instant.
      next: { revalidate: 300 },
    })
    if (!res.ok) throw new Error(`Wikipedia responded ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

function trimExtract(extract?: string): string | null {
  if (!extract) return null
  const clean = extract.trim()
  if (!clean) return null
  // Keep the first sentence or two so cards stay compact.
  if (clean.length <= 240) return clean
  const cut = clean.slice(0, 240)
  const lastStop = cut.lastIndexOf(". ")
  return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "…")
}

export async function fetchNearbyLandmarks(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<Landmark[]> {
  // Wikipedia's GeoSearch finds notable nearby places (historic buildings,
  // monuments, landmarks) fast and reliably, and gives us real descriptions
  // and photos — far quicker than the public Overpass servers.
  const geo = await wikiFetch({
    action: "query",
    list: "geosearch",
    gscoord: `${lat}|${lng}`,
    gsradius: String(Math.min(Math.max(radiusMeters, 10), 10000)),
    gslimit: "50",
  })

  const results: GeoSearchResult[] = geo?.query?.geosearch ?? []
  if (results.length === 0) return []

  // Fetch descriptions, short descriptions, thumbnails and coordinates for the
  // found pages. `extracts` allows max 20 pages per request, so batch by 20.
  const details = new Map<number, PageDetail>()
  for (let i = 0; i < results.length; i += 20) {
    const batch = results.slice(i, i + 20)
    const data = await wikiFetch({
      action: "query",
      pageids: batch.map((r) => r.pageid).join("|"),
      prop: "extracts|pageimages|coordinates|description",
      exintro: "1",
      explaintext: "1",
      piprop: "thumbnail",
      pithumbsize: "480",
    })
    const pages: Record<string, PageDetail> = data?.query?.pages ?? {}
    for (const page of Object.values(pages)) {
      details.set(page.pageid, page)
    }
  }

  const landmarks: Landmark[] = results.map((r) => {
    const detail = details.get(r.pageid)
    const shortDesc = detail?.description
    return {
      id: `wikipedia/${r.pageid}`,
      name: r.title,
      // Wikidata's short description (e.g. "Historic house in Boston") makes
      // a great category line; fall back to a generic label.
      category: shortDesc ? shortDesc.replace(/\b\w/, (c) => c.toUpperCase()) : "Landmark",
      lat: r.lat,
      lng: r.lon,
      description: trimExtract(detail?.extract),
      wikipedia: `en:${r.title}`,
      imageUrl: detail?.thumbnail?.source ?? null,
      distanceMeters: r.dist,
    }
  })

  // Already sorted by distance from the API, but be explicit.
  landmarks.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
  return landmarks
}

export function formatDistance(meters?: number): string {
  if (meters == null) return ""
  const feet = meters * 3.28084
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`
  const miles = meters / 1609.344
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}

export function wikipediaUrl(wikipedia: string | null): string | null {
  if (!wikipedia) return null
  // OSM stores this as "en:Article Title"
  const match = wikipedia.match(/^([a-z-]+):(.+)$/i)
  if (match) {
    const [, langCode, title] = match
    return `https://${langCode}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
  }
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(wikipedia.replace(/ /g, "_"))}`
}
