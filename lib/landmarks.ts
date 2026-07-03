// Shared types + OpenStreetMap (Overpass API) helpers for discovering
// historic buildings and landmarks near a location.

export type Landmark = {
  id: string
  name: string
  category: string
  lat: number
  lng: number
  description: string | null
  wikipedia: string | null
  distanceMeters?: number
}

type OverpassElement = {
  type: "node" | "way" | "relation"
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

// Turn a raw OSM "historic" tag into a friendly, readable category.
function prettyCategory(tags: Record<string, string>): string {
  const raw = tags.historic || tags.tourism || tags.building || tags.amenity || "Landmark"
  const map: Record<string, string> = {
    monument: "Monument",
    memorial: "Memorial",
    building: "Historic Building",
    church: "Historic Church",
    castle: "Castle",
    fort: "Fort",
    ruins: "Ruins",
    archaeological_site: "Archaeological Site",
    battlefield: "Battlefield",
    manor: "Manor",
    tower: "Tower",
    city_gate: "City Gate",
    heritage: "Heritage Site",
    attraction: "Attraction",
    museum: "Museum",
    ship: "Historic Ship",
    aircraft: "Historic Aircraft",
    locomotive: "Historic Locomotive",
    wayside_cross: "Wayside Cross",
    wayside_shrine: "Wayside Shrine",
    boundary_stone: "Boundary Stone",
    milestone: "Milestone",
  }
  return (
    map[raw] ||
    raw
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function buildDescription(tags: Record<string, string>): string | null {
  const parts: string[] = []
  if (tags.inscription) parts.push(tags.inscription)
  if (tags["heritage:operator"]) parts.push(`Recognized by ${tags["heritage:operator"].toUpperCase()}`)
  if (tags.start_date) parts.push(`Dates from ${tags.start_date}`)
  if (tags.architect) parts.push(`Architect: ${tags.architect}`)
  if (tags.operator) parts.push(`Operated by ${tags.operator}`)
  return parts.length ? parts.join(" · ") : null
}

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

export async function fetchNearbyLandmarks(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<Landmark[]> {
  // Query OpenStreetMap for historic sites and notable attractions nearby.
  const query = `
    [out:json][timeout:25];
    (
      node["historic"](around:${radiusMeters},${lat},${lng});
      way["historic"](around:${radiusMeters},${lat},${lng});
      node["heritage"](around:${radiusMeters},${lat},${lng});
      way["heritage"](around:${radiusMeters},${lat},${lng});
      node["tourism"="attraction"]["name"](around:${radiusMeters},${lat},${lng});
    );
    out center tags 80;
  `

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ]

  let data: { elements: OverpassElement[] } | null = null
  let lastError: unknown = null

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        // Cache identical location queries briefly to be kind to the API.
        next: { revalidate: 300 },
      })
      if (!res.ok) {
        lastError = new Error(`Overpass responded ${res.status}`)
        continue
      }
      data = await res.json()
      break
    } catch (err) {
      lastError = err
    }
  }

  if (!data) {
    throw lastError instanceof Error ? lastError : new Error("Failed to reach OpenStreetMap")
  }

  const seen = new Set<string>()
  const landmarks: Landmark[] = []

  for (const el of data.elements) {
    const tags = el.tags || {}
    const name = tags.name || tags["name:en"]
    if (!name) continue // skip unnamed features — not useful to a traveler

    const coordLat = el.lat ?? el.center?.lat
    const coordLng = el.lon ?? el.center?.lon
    if (coordLat == null || coordLng == null) continue

    const id = `${el.type}/${el.id}`
    const dedupeKey = name.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    landmarks.push({
      id,
      name,
      category: prettyCategory(tags),
      lat: coordLat,
      lng: coordLng,
      description: buildDescription(tags),
      wikipedia: tags.wikipedia || null,
      distanceMeters: haversine(lat, lng, coordLat, coordLng),
    })
  }

  landmarks.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
  return landmarks.slice(0, 50)
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
