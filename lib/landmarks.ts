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
  // Keep several full sentences so the fact is genuinely interesting (history,
  // significance, notable details) rather than a bare one-liner, while still
  // staying readable on a card. ~520 chars ≈ 3-4 sentences.
  const MAX = 520
  if (clean.length <= MAX) return clean
  const cut = clean.slice(0, MAX)
  // Prefer to end on a complete sentence.
  const lastStop = cut.lastIndexOf(". ")
  return lastStop > 160 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "…"
}

// Great-circle distance in meters between two lat/lng points.
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Normalize a place name for de-duplication across data sources.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

type OverpassElement = {
  type: "node" | "way" | "relation"
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

// Supplementary source: OpenStreetMap historic sites (memorials, monuments,
// ruins, historic buildings, markers). These catch many named historic places
// that don't have their own Wikipedia article, so downtown coverage is far
// more complete. Best-effort: if Overpass is slow or down, we simply skip it.
async function fetchOverpassHistoric(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<Landmark[]> {
  const radius = Math.min(Math.max(Math.round(radiusMeters), 10), 16000)
  // A bounding-box query is dramatically faster than an `around` radius scan on
  // Overpass (which times out over large areas). We compute a bbox from the
  // center + radius, then filter back to the exact circle via haversine below.
  const dLat = radius / 111320
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180))
  const bbox = `${lat - dLat},${lng - dLng},${lat + dLat},${lng + dLng}`
  const query = `[out:json][timeout:25];nwr[historic][name](${bbox});out center tags 400;`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 14000)
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Overpass returns 406 Not Acceptable without an explicit Accept header
        // and a descriptive User-Agent.
        Accept: "application/json",
        "User-Agent": "Waymarks/1.0 (historic landmark tracker)",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
      next: { revalidate: 300 },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { elements?: OverpassElement[] }
    const elements = data.elements ?? []
    const out: Landmark[] = []
    for (const el of elements) {
      const name = el.tags?.name
      const plat = el.lat ?? el.center?.lat
      const plng = el.lon ?? el.center?.lon
      if (!name || plat == null || plng == null) continue
      const dist = haversine(lat, lng, plat, plng)
      // bbox is a square; drop corners that fall outside the requested circle.
      if (dist > radius) continue
      const historic = el.tags?.historic
      // Turn "memorial" / "monument" / "yes" into a friendly category.
      const category =
        historic && historic !== "yes"
          ? `Historic ${historic.replace(/_/g, " ")}`.replace(/\b\w/, (c) => c.toUpperCase())
          : "Historic site"
      out.push({
        id: `osm/${el.type}/${el.id}`,
        name,
        category,
        kind: "landmark",
        lat: plat,
        lng: plng,
        description: el.tags?.description ?? el.tags?.inscription ?? null,
        wikipedia: el.tags?.wikipedia ?? null,
        imageUrl: null,
        distanceMeters: dist,
      })
    }
    return out
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchNearbyLandmarks(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<Landmark[]> {
  // Two sources in parallel:
  //  1. Wikipedia GeoSearch — notable places with rich descriptions + photos.
  //  2. OpenStreetMap historic sites — catches memorials, monuments, markers
  //     and historic buildings that lack a Wikipedia article.
  const [geo, osmHistoric] = await Promise.all([
    wikiFetch({
      action: "query",
      list: "geosearch",
      gscoord: `${lat}|${lng}`,
      gsradius: String(Math.min(Math.max(radiusMeters, 10), 10000)),
      // Pull a large set (max 500) so dense downtowns aren't truncated to just
      // the closest block. We fetch heavy details only for the kept subset.
      gslimit: "500",
    }).catch(() => null),
    fetchOverpassHistoric(lat, lng, radiusMeters),
  ])

  const results: GeoSearchResult[] = geo?.query?.geosearch ?? []

  // Keep the nearest N Wikipedia results for detail lookup. This is the only
  // expensive step, so capping it (not the geosearch) keeps us fast while still
  // covering far more than the old 50-item limit.
  const DETAIL_CAP = 140
  const kept = results.slice(0, DETAIL_CAP)

  // Fetch descriptions, short descriptions, thumbnails and coordinates for the
  // kept pages. `extracts` allows max 20 pages per request, so batch by 20.
  // Wikipedia rate-limits bursts (HTTP 429), so we run only a couple of batches
  // at a time and skip any that fail — partial detail is better than no result.
  const details = new Map<number, PageDetail>()
  const batches: GeoSearchResult[][] = []
  for (let i = 0; i < kept.length; i += 20) {
    batches.push(kept.slice(i, i + 20))
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

  const wikiLandmarks: Landmark[] = kept.map((r) => {
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

  // Merge in OSM historic sites, skipping any that duplicate a Wikipedia entry
  // (same normalized name, or already linked to a Wikipedia article).
  const seen = new Set(wikiLandmarks.map((l) => normalizeName(l.name)))
  const extraHistoric = osmHistoric.filter((l) => {
    const key = normalizeName(l.name)
    if (seen.has(key) || l.wikipedia) return false
    seen.add(key)
    return true
  })

  const all = [...wikiLandmarks, ...extraHistoric]

  // Strictly enforce the requested radius. Wikipedia's geosearch radius is
  // imprecise (it can return places slightly beyond gsradius), so we hard-filter
  // here — this guarantees a smaller radius reliably narrows to only what's
  // truly within range. A small 5% tolerance absorbs coordinate rounding.
  const maxDist = radiusMeters * 1.05
  const within = all.filter((l) => (l.distanceMeters ?? 0) <= maxDist)

  // Keep every town (relatively rare, and the whole point of the Towns filter)
  // plus the nearest individual landmarks, so towns are never trimmed away.
  const towns = within.filter((l) => l.kind === "town")
  const nearestLandmarks = within
    .filter((l) => l.kind === "landmark")
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
    .slice(0, 150)

  return [...towns, ...nearestLandmarks].sort(
    (a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0),
  )
}

// Search Wikipedia for a place BY NAME (not by location). This powers the
// "I'm walking past a specific landmark" flow: the user types a name and we
// find matching places anywhere, so they can log something even if it wasn't
// in the nearby list. If `near` is provided we compute + sort by distance.
export async function searchLandmarksByName(
  query: string,
  near?: { lat: number; lng: number },
): Promise<Landmark[]> {
  const q = query.trim()
  if (!q) return []

  // Full-text search for matching articles. We bias toward geolocated places
  // by requesting coordinates in the same generator query.
  const data = await wikiFetch({
    action: "query",
    generator: "search",
    gsrsearch: q,
    gsrlimit: "20",
    gsrnamespace: "0",
    prop: "coordinates|extracts|pageimages|description",
    exintro: "1",
    explaintext: "1",
    piprop: "thumbnail",
    pithumbsize: "480",
    // "max" so EVERY result gets its coordinates (colimit caps total coords
    // across the whole query, not per page — a low value silently drops places).
    colimit: "max",
  }).catch(() => null)

  const pages: Record<string, PageDetail & { index?: number }> = data?.query?.pages ?? {}
  const list = Object.values(pages)

  // Score how well a title matches the typed name so the actual landmark ranks
  // above nearby-but-unrelated places (e.g. searching "Pioneer Courthouse"
  // shouldn't surface "Portland, Oregon" just because it's closer).
  const nq = q.toLowerCase()
  const nameScore = (title: string): number => {
    const t = title.toLowerCase()
    if (t === nq) return 3
    if (t.startsWith(nq)) return 2
    if (t.includes(nq)) return 1
    return 0
  }

  const results: Array<Landmark & { _index: number; _score: number }> = []
  for (const page of list) {
    const coord = page.coordinates?.[0]
    // Only keep pages that are actual places (have coordinates on a map).
    if (!coord) continue
    const shortDesc = page.description
    results.push({
      id: `wikipedia/${page.pageid}`,
      name: page.title,
      category: shortDesc ? shortDesc.replace(/\b\w/, (c) => c.toUpperCase()) : "Landmark",
      kind: classifyKind(shortDesc),
      lat: coord.lat,
      lng: coord.lon,
      description: trimExtract(page.extract),
      wikipedia: `en:${page.title}`,
      imageUrl: page.thumbnail?.source ?? null,
      distanceMeters: near ? haversine(near.lat, near.lng, coord.lat, coord.lon) : undefined,
      _index: page.index ?? 0,
      _score: nameScore(page.title),
    })
  }

  // Rank by name-match quality first. Within the same quality, prefer nearer
  // places (helps disambiguate when you're standing next to it), falling back
  // to Wikipedia's own relevance order when we have no location.
  results.sort((a, b) => {
    if (a._score !== b._score) return b._score - a._score
    if (near) return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)
    return a._index - b._index
  })

  return results.map(({ _index, _score, ...rest }) => rest)
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
