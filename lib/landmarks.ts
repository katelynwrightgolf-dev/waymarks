// Shared types + OpenStreetMap (Overpass API) helpers for discovering
// historic buildings and landmarks near a location.

export type LandmarkKind = "town" | "landmark"

export type Landmark = {
  id: string
  name: string
  category: string | null
  kind: LandmarkKind
  lat: number
  lng: number
  description: string | null
  wikipedia: string | null
  imageUrl: string | null
  distanceMeters?: number
}

// Decide whether a Wikipedia place is a town/settlement (vs. a single
// building or monument) based on its short description, e.g.
// "Town in Washington", "Unincorporated community in King County".
function classifyKind(shortDesc?: string): LandmarkKind {
  if (!shortDesc) return "landmark"
  const d = shortDesc.toLowerCase()
  // Wikidata describes populated places as "<type> in <place>", e.g.
  // "City in Massachusetts", "Town in Maryland", "Unincorporated community in
  // King County". Requiring the trailing "in" avoids false positives like
  // "City hall in Boston" or "Town square in ..." (buildings, not towns).
  const townPattern =
    /\b(town|city|village|hamlet|borough|municipality|township|suburb|county seat|ghost town|census[- ]designated place|unincorporated community|human settlement|populated place)\s+in\b/
  return townPattern.test(d) ? "town" : "landmark"
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

async function wikiFetch(params: Record<string, string>, attempts = 2): Promise<any> {
  const url = `${WIKI_API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
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
      return await res.json()
    } catch (err) {
      lastError = err
      // Brief backoff before retrying a transient timeout/5xx.
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 400))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
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
    // Cast a wider net (100) so surrounding towns aren't crowded out by the
    // many buildings/monuments that cluster nearest to the search point.
    gslimit: "100",
  })

  const results: GeoSearchResult[] = geo?.query?.geosearch ?? []
  if (results.length === 0) return []

  // Fetch descriptions, short descriptions, thumbnails and coordinates for the
  // found pages. `extracts` allows max 20 pages per request, so batch by 20.
  // Wikipedia rate-limits bursts (HTTP 429), so we run only a couple of batches
  // at a time and skip any that fail — partial detail is better than no result.
  const details = new Map<number, PageDetail>()
  const batches: GeoSearchResult[][] = []
  for (let i = 0; i < results.length; i += 20) {
    batches.push(results.slice(i, i + 20))
  }

  const CONCURRENCY = 2
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const slice = batches.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      slice.map((batch) =>
        wikiFetch({
          action: "query",
          pageids: batch.map((r) => r.pageid).join("|"),
          prop: "extracts|pageimages|coordinates|description",
          exintro: "1",
          explaintext: "1",
          piprop: "thumbnail",
          pithumbsize: "480",
        }),
      ),
    )
    for (const result of settled) {
      if (result.status !== "fulfilled") continue
      const pages: Record<string, PageDetail> = result.value?.query?.pages ?? {}
      for (const page of Object.values(pages)) {
        details.set(page.pageid, page)
      }
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
      kind: classifyKind(shortDesc),
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

  // Keep every town we found (they're the whole point of the Towns filter and
  // are relatively rare) plus the nearest individual landmarks, so towns never
  // get dropped when we trim the wider result set back down.
  const towns = landmarks.filter((l) => l.kind === "town")
  const nearestLandmarks = landmarks.filter((l) => l.kind === "landmark").slice(0, 50)
  return [...towns, ...nearestLandmarks].sort(
    (a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0),
  )
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
