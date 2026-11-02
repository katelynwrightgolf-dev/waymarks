#!/usr/bin/env node
// Builds the offline places file the app ships: every National Register of
// Historic Places listing (National Park Service) plus every official Texas
// Historical Commission marker. Name + location only, to keep it small.
//
//   node scripts/build-places.mjs
//
// Writes public/places/places-<date>.json and lib/places-manifest.ts (which
// points the app at the new file). Re-run whenever you want fresher data.
// Needs network access and the `unzip` command.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const NRHP = "https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer"
const THC_ZIP = "https://atlas.thc.texas.gov/staticFile/HistoricalMarkers_shp.zip"
const PAGE = 2000

async function getJson(url, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(JSON.stringify(data.error))
      return data
    } catch (err) {
      if (i >= attempts) throw new Error(`${url}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

const cleanName = (s) => String(s ?? "").replace(/\s+/g, " ").trim()
const validCoord = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

// --- National Register (NPS) ------------------------------------------------
// Layer 0 is points, layer 1 is polygons (larger properties and districts).
// A polygon becomes one point at the average of its outline's vertices, the
// same way lib/landmarks.ts treats NPS polygons today.
async function fetchNrhpLayer(layer) {
  const { count } = await getJson(`${NRHP}/${layer}/query?where=1%3D1&returnCountOnly=true&f=json`)
  const out = []
  for (let offset = 0; offset < count; offset += PAGE) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "NRIS_Refnum,RESNAME",
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "5",
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "json",
      ...(layer === 1 ? { maxAllowableOffset: "0.0005" } : {}),
    })
    const data = await getJson(`${NRHP}/${layer}/query?${params}`)
    for (const f of data.features ?? []) {
      const g = f.geometry ?? {}
      let lat = g.y
      let lng = g.x
      if (lat == null) {
        const pts = (g.rings ?? []).flat()
        if (!pts.length) continue
        lng = pts.reduce((s, p) => s + p[0], 0) / pts.length
        lat = pts.reduce((s, p) => s + p[1], 0) / pts.length
      }
      out.push({ ref: f.attributes?.NRIS_Refnum?.trim(), name: cleanName(f.attributes?.RESNAME), lat, lng })
    }
    process.stdout.write(`\r  NRHP layer ${layer}: ${Math.min(offset + PAGE, count)}/${count}`)
  }
  process.stdout.write("\n")
  return { count, rows: out }
}

// --- Texas historical markers (THC) -----------------------------------------
// Locations come from the shapefile GEOMETRY, not the LATITUDE/LONGITUDE
// attribute columns. Checked 2026-11-02 against the 16,153-marker file:
//  - 3,018 markers have 0,0 in the attribute columns but a real point.
//  - 4,266 more disagree with their own point by >100 m (102 by >100 km).
//    Every point lands inside Texas; 76 attribute pairs land outside it.
//    Spot checks (Camp Swift → Bastrop Co., Cone → Crosby Co.) match the point.
//  - Where both agree, they agree to a median 0.6 m, which confirms the
//    projection math below.
// The points are in the Texas Statewide Mapping System (Lambert Conformal
// Conic, NAD83), so they're converted to latitude/longitude here.
const R = Math.PI / 180
const GRS80_A = 6378137
const GRS80_E = Math.sqrt(2 / 298.257222101 - (1 / 298.257222101) ** 2)
const lccM = (p) => Math.cos(p) / Math.sqrt(1 - (GRS80_E * Math.sin(p)) ** 2)
const lccT = (p) =>
  Math.tan(Math.PI / 4 - p / 2) / ((1 - GRS80_E * Math.sin(p)) / (1 + GRS80_E * Math.sin(p))) ** (GRS80_E / 2)

function texasLambertInverse(prjText) {
  const param = (name) => {
    const m = prjText.match(new RegExp(`PARAMETER\\["${name}",(-?[\\d.]+)\\]`))
    if (!m) throw new Error(`THC .prj is missing ${name}; the projection may have changed`)
    return Number.parseFloat(m[1])
  }
  if (!/Lambert_Conformal_Conic/.test(prjText) || !/GRS_1980/.test(prjText)) {
    throw new Error("THC markers are no longer in Lambert Conformal Conic / GRS80; update the conversion")
  }
  const p1 = param("Standard_Parallel_1") * R
  const p2 = param("Standard_Parallel_2") * R
  const p0 = param("Latitude_Of_Origin") * R
  const l0 = param("Central_Meridian") * R
  const fe = param("False_Easting")
  const fn = param("False_Northing")
  const n = (Math.log(lccM(p1)) - Math.log(lccM(p2))) / (Math.log(lccT(p1)) - Math.log(lccT(p2)))
  const F = lccM(p1) / (n * lccT(p1) ** n)
  const rho0 = GRS80_A * F * lccT(p0) ** n
  return (x, y) => {
    const dx = x - fe
    const dy = rho0 - (y - fn)
    const t = (Math.sign(n) * Math.hypot(dx, dy) / (GRS80_A * F)) ** (1 / n)
    let phi = Math.PI / 2 - 2 * Math.atan(t)
    for (let i = 0; i < 8; i++) {
      const es = GRS80_E * Math.sin(phi)
      phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (GRS80_E / 2))
    }
    return { lat: phi / R, lng: (Math.atan2(dx, dy) / n + l0) / R }
  }
}

// Point shapefile: 100-byte header, then per record an 8-byte header and
// [shapeType:int32LE, x:float64LE, y:float64LE].
function readShpPoints(file) {
  const buf = fs.readFileSync(file)
  const pts = []
  for (let o = 100; o < buf.length; ) {
    const contentBytes = buf.readInt32BE(o + 4) * 2
    const type = buf.readInt32LE(o + 8)
    pts.push(type === 1 ? { x: buf.readDoubleLE(o + 12), y: buf.readDoubleLE(o + 20) } : null)
    o += 8 + contentBytes
  }
  return pts
}

function readDbf(file) {
  const buf = fs.readFileSync(file)
  const n = buf.readUInt32LE(4)
  const headerLen = buf.readUInt16LE(8)
  const recordLen = buf.readUInt16LE(10)
  const fields = []
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    fields.push({ name: buf.toString("latin1", o, o + 11).replace(/\0.*$/, ""), len: buf[o + 16] })
  }
  const rows = []
  for (let i = 0; i < n; i++) {
    let p = headerLen + i * recordLen
    const deleted = buf[p] === 0x2a
    p += 1
    const row = { deleted }
    for (const f of fields) {
      row[f.name] = buf.toString("utf8", p, p + f.len).trim()
      p += f.len
    }
    rows.push(row)
  }
  return { count: n, rows }
}

async function fetchThc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thc-markers-"))
  const zip = path.join(dir, "markers.zip")
  const res = await fetch(THC_ZIP, { signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`THC download failed: HTTP ${res.status}`)
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
  execFileSync("unzip", ["-o", "-q", zip, "-d", dir])
  const dbf = execFileSync("find", [dir, "-name", "*.dbf"]).toString().trim().split("\n")[0]
  const { count, rows } = readDbf(dbf)
  const points = readShpPoints(dbf.replace(/\.dbf$/, ".shp"))
  const toLatLng = texasLambertInverse(fs.readFileSync(dbf.replace(/\.dbf$/, ".prj"), "utf8"))
  fs.rmSync(dir, { recursive: true, force: true })
  if (points.length !== rows.length) throw new Error(`THC .shp has ${points.length} points but .dbf has ${rows.length} rows`)
  const out = []
  rows.forEach((r, i) => {
    if (r.deleted || !points[i]) return
    const { lat, lng } = toLatLng(points[i].x, points[i].y)
    // Atlas number is the THC's own unique id (16,150 distinct of 16,153).
    const atlas = Math.round(Number.parseFloat(r.ATLAS_NUM))
    out.push({ ref: atlas > 0 ? String(atlas) : "", name: cleanName(r.NAME), lat, lng })
  })
  return { count, rows: out }
}

// --- Pack -------------------------------------------------------------------
// Columnar JSON: one names array, one ids array, and coordinates as integers
// (degrees × 100,000 ≈ 1 m), each delta-encoded against the previous entry
// after sorting by latitude. Small numbers compress far better than raw floats.
function pack(source, rows) {
  rows.sort((a, b) => a.lat - b.lat || a.lng - b.lng)
  const names = []
  const ids = []
  const lat = []
  const lng = []
  let pLat = 0
  let pLng = 0
  for (const r of rows) {
    const la = Math.round(r.lat * 1e5)
    const ln = Math.round(r.lng * 1e5)
    names.push(r.name)
    ids.push(r.ref)
    lat.push(la - pLat)
    lng.push(ln - pLng)
    pLat = la
    pLng = ln
  }
  return { source, count: rows.length, names, ids, lat, lng }
}

function dedupe(rows, label) {
  const seen = new Set()
  const out = []
  let dropped = { noName: 0, badCoord: 0, dupRef: 0 }
  for (const r of rows) {
    if (!r.name) { dropped.noName++; continue }
    if (!validCoord(r.lat, r.lng)) { dropped.badCoord++; continue }
    const key = r.ref || `${r.name}|${r.lat.toFixed(4)}|${r.lng.toFixed(4)}`
    if (seen.has(key)) { dropped.dupRef++; continue }
    seen.add(key)
    out.push(r)
  }
  console.log(`  ${label}: kept ${out.length}, dropped ${JSON.stringify(dropped)}`)
  return out
}

const started = Date.now()
console.log("Fetching National Register (NPS)…")
const points = await fetchNrhpLayer(0)
const polygons = await fetchNrhpLayer(1)
if (points.rows.length !== points.count || polygons.rows.length !== polygons.count) {
  console.warn(
    `  WARNING: NPS returned ${points.rows.length}/${points.count} points and ${polygons.rows.length}/${polygons.count} polygons`,
  )
}
// Points first, so a property with both a point and a polygon keeps its point.
const nrhp = dedupe([...points.rows, ...polygons.rows], "NRHP")

console.log("Fetching Texas historical markers (THC)…")
const thcRaw = await fetchThc()
const thc = dedupe(thcRaw.rows, "THC markers")

const built = new Date().toISOString().slice(0, 10)
const file = `places-${built.replaceAll("-", "")}.json`
const payload = {
  v: 1,
  built,
  sources: {
    nrhp: { label: "National Register of Historic Places", from: "National Park Service", upstream: points.count + polygons.count },
    thc: { label: "Texas Historical Marker", from: "Texas Historical Commission", upstream: thcRaw.count },
  },
  sets: [pack("nrhp", nrhp), pack("thc", thc)],
}
const outDir = path.join(ROOT, "public", "places")
fs.mkdirSync(outDir, { recursive: true })
for (const old of fs.readdirSync(outDir)) if (/^places-\d+\.json$/.test(old)) fs.rmSync(path.join(outDir, old))
const json = JSON.stringify(payload)
fs.writeFileSync(path.join(outDir, file), json)
fs.writeFileSync(
  path.join(ROOT, "lib", "places-manifest.ts"),
  `// Generated by scripts/build-places.mjs — do not edit by hand.\n` +
    `export const PLACES_URL = "/places/${file}"\n` +
    `export const PLACES_BUILT = "${built}"\n` +
    `export const PLACES_COUNT = ${nrhp.length + thc.length}\n`,
)
console.log(
  `Wrote public/places/${file}: ${nrhp.length} NRHP + ${thc.length} THC = ${nrhp.length + thc.length} places, ` +
    `${(json.length / 1e6).toFixed(2)} MB raw, in ${Math.round((Date.now() - started) / 1000)}s`,
)
