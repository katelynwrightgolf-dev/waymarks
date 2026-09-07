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

// Wikipedia's GeoSearch returns EVERY article near a point — high schools,
// hospitals, malls, stadiums, radio stations — most of which aren't historical
// marks. These two patterns let us keep only genuine heritage sites.

// Everyday modern institutions. Dropped unless they carry a real historic
// designation (see STRONG_HISTORIC), which is how a schoolhouse listed on the
// National Register still makes the cut while the local high school doesn't.
const MODERN_NOISE =
  /\b(high school|middle school|elementary school|primary school|secondary school|junior high|school district|charter school|private school|public school|community college|university|college|hospital|medical cent(er|re)|clinic|shopping (mall|cent(er|re))|supermarket|grocery|restaurant|hotel|motel|apartment|condominium|office (building|tower)|skyscraper|radio station|television station|tv station|newspaper|magazine|company|corporation|manufacturer|retailer|bank|credit union|airport|heliport|bus (station|terminal)|light rail|metro station|subway station|transit cent(er|re)|(football|soccer|baseball|basketball|hockey) (team|club)|stadium|arena|golf course|country club|nightclub|night club|gay bar|sports bar|dive bar|strip club|cocktail lounge|brewery|winery|distillery|dispensary|food cart|food truck|food hall|beer garden|bookstore|book ?shop|record store|thrift store|coffee (shop|house|roaster)|bakery|housing authority|gas station|parking (lot|garage)|fire station|police station|prison|correctional|data cent(er|re)|power (plant|station)|wastewater|landfill|warehouse|business park|industrial park|shopping district|neighborhood|neighbourhood|(city|public|state|national|regional|county|amusement|water|skate|dog) park\b|bridge carrying|highway|freeway|interstate|state route|road in|street in)\b/i

// Signals that a place genuinely is a historical mark / heritage site.
const HISTORIC_SIGNAL =
  /\b(historic|historical|national register|nrhp|national historic landmark|heritage|monument|memorial|museum|marker|plaque|landmark|ruins?|archaeolog|battlefield|fort|fortress|mission|pioneer|settler|antebellum|victorian|colonial|courthouse|cathedral|basilica|chapel|meeting house|homestead|mansion|manor|covered bridge|lighthouse|depot|roundhouse|opera house|theatre|theater|city hall|capitol|cemetery|graveyard|burial|shipwreck|grist ?mill|sawmill|mine|smelter|trading post|stagecoach|saloon|tavern|schoolhouse|one[- ]room school|blacksmith|apothecary|log cabin|adobe|petroglyph|pictograph|burial mound|earthwork|windmill|canal|aqueduct|jail|gallows|oregon trail|(founded|built|established|constructed|erected|dedicated) in (1[5-8]\d\d|19[0-2]\d)|(1[5-8]\d\d|19[0-2]\d)s?\b|(16|17|18|19)th[- ]century)\b/i

// A formal heritage designation — strong enough to rescue an otherwise modern
// institution from being filtered out.
const STRONG_HISTORIC =
  /\b(national register of historic places|national historic landmark|historic district|historic site|listed on the national register|heritage (register|site)|historical society)\b/i

// Commemorative works — a statue, bust, or monument exists specifically to
// remember a person or event, so it always belongs in this list even when the
// article never uses the word "historic".
const COMMEMORATIVE =
  /\b(statue|statues|bust of|equestrian|monument|memorial|cenotaph|obelisk|totem pole|war memorial|commemorat|effigy|sculpture of|relief sculpture|fountain of)\b/i

// "Really interesting history" — places whose story is the draw, even without a
// formal heritage designation: battles, disasters, crimes, folklore. Each of
// these is strong enough on its own to qualify a place.
const INTERESTING_HISTORY =
  /\b(battle|siege|massacre|skirmish|treaty|uprising|rebellion|revolt|riot|labor strike|civil war|revolutionary war|world war|war of 1812|underground railroad|abolitionist|suffrage|civil rights|internment|gold rush|silver rush|boomtown|ghost town|homestead act|lewis and clark|oregon trail|santa fe trail|pony express|transcontinental|indigenous|tribal|native american|first nations|birthplace|grave of|buried here|assassinat|duel|gunfight|outlaw|bank robbery|shootout|bootleg|speakeasy|prohibition|smuggl|shipwreck|disaster|great fire|conflagration|earthquake|flood of|epidemic|pandemic|quarantine|plague|explosion|derailment|legend|folklore|haunted|ghost story|pioneer|frontier|expedition|fur trade|whaling|cannery|logging camp|railroad town|company town|utopian|commune)\b/i

// Weak, ambiguous cues. "The city's oldest…" or "named after…" describes a
// modern food-cart pod just as easily as a heritage site, so these only count
// when the text ALSO carries a genuine period cue (see PERIOD_CUE).
const STORY_WEAK =
  /\b((the )?(first|oldest|last surviving|only remaining|longest[- ]running)|named (after|for)|namesake|home of|residence of|childhood home|founded by|settled by|former site|site of)\b/i

// Contemporary public art, e.g. "1990 sculpture by John T. Young". It's a
// statue, but not a historical one — so it has to earn its place through an
// actual story rather than the blanket commemorative pass below.
const MODERN_ART =
  /\b(19[3-9]\d|20[0-2]\d) (sculpture|statue|artwork|mural|installation|fountain)\b/i

// Evidence the place actually dates from a historical era.
const PERIOD_CUE =
  /\b((1[5-8]\d\d|19[0-2]\d)s?|(16|17|18|19)th[- ]century|antebellum|victorian|colonial|pioneer|frontier)\b/i

// Broadcast stations (AM/FM radio, TV). Wikipedia titles these by bare callsign
// ("KGDC", "KTEL (AM)") and often describes them only in the article body, so
// the name+description MODERN_NOISE check can miss them. This is matched against
// the FULL text and drops them outright — a radio station is never a heritage
// site someone walks past and logs, even in the rare case it cites old dates or
// a designation. Kept deliberately narrow (station descriptors, broadcast
// frequencies, callsign markers) so a genuine "site of the first radio
// broadcast" marker isn't caught.
const BROADCAST =
  /\bradio station\b|\btelevision station\b|\btv station\b|\b(?:am|fm) (?:radio )?station\b|\((?:am|fm)\)|\b\d{3,4}\s?khz\b|\b\d{2,3}\.\d\s?mhz\b|\bbroadcasting (?:on|a|an)\b|\bcall ?sign\b/i

// Abstract or administrative entities that are never a place you can walk past
// and log: whole states, counties, wine regions, movements, organizations,
// list/index articles. These often mention 1800s dates, so without this guard
// they slip through the historic-year cue below.
const NOT_A_LANDMARK =
  /\b(u\.?s\.? state|state in the|county in|counties of|province in|prefecture|region in|metropolitan area|urban area|census area|census-designated|electoral district|congressional district|viticultural area|\bava\b|appellation|wine region|protest movement|social movement|political party|marketing organization|trade union|discography|filmography|television market|radio market|list of|index of|glossary)\b/i

// Decide whether a Wikipedia result belongs in a historical-landmarks list.
function isHistoricPlace(name: string, shortDesc?: string, extract?: string): boolean {
  const label = `${name} ${shortDesc ?? ""}`
  const haystack = `${label} ${extract ?? ""}`
  // Broadcast station? Drop unconditionally, checking the whole article text so
  // bare-callsign titles and format-only descriptions can't sneak through.
  if (BROADCAST.test(haystack)) return false
  // Not an individual site at all -> never a landmark, even if it cites old
  // dates. (Towns are handled before this function is ever called.)
  if (NOT_A_LANDMARK.test(label)) return false
  // Modern institution? Require a formal heritage designation to keep it. This
  // runs first so "Memorial Hospital" / "Memorial Stadium" don't sneak in via
  // the commemorative check below.
  if (MODERN_NOISE.test(label)) return STRONG_HISTORIC.test(haystack)
  // Contemporary public art is only kept when the work itself is commemorative
  // — a memorial/monument, or a statue OF someone. We judge this on the title
  // and short description alone, because a passing mention of, say, a pioneer
  // in the article body doesn't make an abstract modern sculpture historical.
  if (MODERN_ART.test(label)) {
    return (
      /\b(memorial|monument|commemorat|cenotaph)\b/i.test(label) ||
      /\b(statue|bust) of [A-Z]/.test(label) ||
      STRONG_HISTORIC.test(haystack)
    )
  }
  // A statue/monument by name is commemorative by definition — always keep.
  if (COMMEMORATIVE.test(label)) return true
  // An explicit heritage cue, or a genuinely interesting story.
  if (HISTORIC_SIGNAL.test(haystack) || INTERESTING_HISTORY.test(haystack)) return true
  // Last resort: a weak cue ("the oldest…") counts only with a period cue.
  return STORY_WEAK.test(haystack) && PERIOD_CUE.test(haystack)
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
  // Union of everything that represents a historical mark. The plaque and
  // history-board queries are what surface actual roadside historical markers,
  // which rarely have their own Wikipedia article; the memorial/artwork queries
  // catch commemorative statues and busts.
  //
  // Note the information boards are matched on `information=history` or a
  // history-related `board_type` rather than a bare `information=board` — a
  // plain board is just as likely to be a trail map or transit timetable, which
  // would pollute the list with things that aren't historical markers at all.
  // Note we deliberately DON'T require [name] on the marker-like queries: real
  // roadside markers frequently carry no name tag at all — their text lives in
  // `inscription`. Those are recovered below by using the inscription as the
  // display name, instead of being silently dropped.
  const query =
    `[out:json][timeout:25];(` +
    `nwr[historic][name](${bbox});` +
    `nwr[historic=memorial](${bbox});` +
    `nwr[historic=monument](${bbox});` +
    `nwr[historic=ruins](${bbox});` +
    `nwr[historic=archaeological_site](${bbox});` +
    `nwr[historic=wayside_shrine](${bbox});` +
    `nwr[historic=boundary_stone](${bbox});` +
    `nwr[man_made=plaque](${bbox});` +
    `nwr[memorial](${bbox});` +
    `nwr[tourism=information][information~"^(history|plaque)$"](${bbox});` +
    `nwr[tourism=information][board_type~"^(history|historic)"](${bbox});` +
    `);out center tags 500;`

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
      const plat = el.lat ?? el.center?.lat
      const plng = el.lon ?? el.center?.lon
      if (plat == null || plng == null) continue
      const inscriptionText = el.tags?.inscription ?? el.tags?.description
      // A named object uses its name; an unnamed marker falls back to its
      // inscription (truncated) so it's still loggable. Objects with neither a
      // name nor any text are skipped — a blank "historic thing" isn't useful.
      const name =
        el.tags?.name ??
        (inscriptionText ? inscriptionText.replace(/\s+/g, " ").trim().slice(0, 70) : null)
      if (!name) continue
      const dist = haversine(lat, lng, plat, plng)
      // bbox is a square; drop corners that fall outside the requested circle.
      if (dist > radius) continue
      const historic = el.tags?.historic
      const memorial = el.tags?.memorial
      const artwork = el.tags?.artwork_type
      // A genuine roadside marker: a plaque or a dedicated history board.
      const isMarker =
        el.tags?.man_made === "plaque" ||
        memorial === "plaque" ||
        memorial === "stele" ||
        el.tags?.tourism === "information"
      // A commemorative figure — statue, bust, or obelisk.
      const isStatue =
        memorial === "statue" ||
        memorial === "bust" ||
        memorial === "obelisk" ||
        artwork === "statue" ||
        artwork === "bust"
      const category = isMarker
        ? "Historical marker"
        : isStatue
          ? "Statue or monument"
          : historic && historic !== "yes"
            ? `Historic ${historic.replace(/_/g, " ")}`.replace(/\b\w/, (c) => c.toUpperCase())
            : "Historic site"
      out.push({
        id: `osm/${el.type}/${el.id}`,
        name,
        category,
        kind: "landmark",
        lat: plat,
        lng: plng,
        // For a marker or plaque the inscription IS the history, so prefer it.
        description:
          (isMarker
            ? (el.tags?.inscription ?? el.tags?.description)
            : (el.tags?.description ?? el.tags?.inscription)) ?? null,
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

  const wikiLandmarks: Landmark[] = kept
    .map((r) => {
      const detail = details.get(r.pageid)
      const shortDesc = detail?.description
      const kind = classifyKind(shortDesc)
      return {
        id: `wikipedia/${r.pageid}`,
        name: r.title,
        // Wikidata's short description (e.g. "Historic house in Boston") makes
        // a great category line; fall back to a generic label.
        category: shortDesc ? shortDesc.replace(/\b\w/, (c) => c.toUpperCase()) : "Landmark",
        kind,
        lat: r.lat,
        lng: r.lon,
        description: trimExtract(detail?.extract),
        wikipedia: `en:${r.title}`,
        imageUrl: detail?.thumbnail?.source ?? null,
        distanceMeters: r.dist,
        // Towns are always kept (the Towns filter depends on them). Everything
        // else has to read as a genuine historical mark rather than, say, the
        // local high school or shopping mall.
        _keep: kind === "town" || isHistoricPlace(r.title, shortDesc, detail?.extract),
      }
    })
    .filter((l) => l._keep)
    .map(({ _keep, ...rest }) => rest)

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
    const kind = classifyKind(shortDesc)
    // Apply the SAME heritage filter used for nearby results, so a name search
    // can't surface a radio station, high school, university, or airport just
    // because it matched the typed text. Towns are always kept (they power the
    // Towns filter and are a legitimate thing to search for).
    if (kind !== "town" && !isHistoricPlace(page.title, shortDesc, page.extract)) continue
    results.push({
      id: `wikipedia/${page.pageid}`,
      name: page.title,
      category: shortDesc ? shortDesc.replace(/\b\w/, (c) => c.toUpperCase()) : "Landmark",
      kind,
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
