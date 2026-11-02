"use client"

import type { Landmark } from "@/lib/landmarks"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useEffect, useRef } from "react"

type MapViewProps = {
  center: [number, number]
  landmarks: Landmark[]
  visitedIds: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
  // Hide the blue "you are here" dot (used on the visited-places map, where
  // there is no live location to show).
  showMe?: boolean
  // Auto-zoom/pan so every pin is framed, instead of centering on `center`.
  fitToLandmarks?: boolean
}

function themeColor(variable: string, fallback: string) {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return value || fallback
}

// Place names come from Wikipedia/OSM; escape them before they go into popup HTML.
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

function pinIcon(color: string, selected: boolean) {
  const size = selected ? 28 : 20
  return L.divIcon({
    className: "waymarks-pin",
    html: `<span style="
      display:block;width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);background:${color};
      border:2px solid rgba(255,255,255,0.9);
      box-shadow:0 2px 6px rgba(0,0,0,0.35);"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
}

// This component drives Leaflet directly (rather than through react-leaflet)
// so we fully control the map lifecycle. react-leaflet v5 under React 19
// StrictMode double-mounts the MapContainer onto the same DOM node, which
// throws "Map container is being reused by another instance" and crashes the
// page. Creating the map in an effect and calling map.remove() on cleanup
// makes remounts (StrictMode, HMR, navigation) safe.
export default function MapView({
  center,
  landmarks,
  visitedIds,
  selectedId,
  onSelect,
  showMe = true,
  fitToLandmarks = false,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const meMarkerRef = useRef<L.CircleMarker | null>(null)
  // Keep the latest onSelect without forcing marker rebuilds.
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Create the map exactly once, and tear it down on unmount.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center,
      zoom: 14,
      scrollWheelZoom: true,
    })
    mapRef.current = map

    // CARTO's basemaps now require an API key (every tile came back as an
    // "API KEY REQUIRED" placeholder), so use OpenStreetMap's own tiles. They
    // get a warm tint in globals.css (.waymarks-map) to match the app.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)

    markerLayerRef.current = L.layerGroup().addTo(map)
    if (showMe) {
      meMarkerRef.current = L.circleMarker(center, {
        radius: 9,
        color: "#ffffff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindPopup("You are here")
    }

    // Leaflet occasionally needs a nudge once its container has real size.
    setTimeout(() => map.invalidateSize(), 0)

    return () => {
      map.remove()
      mapRef.current = null
      markerLayerRef.current = null
      meMarkerRef.current = null
    }
    // Intentionally run once; live updates are handled in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recenter the map and the "you are here" marker when the location changes.
  // Skipped when fitToLandmarks is on — bounds fitting owns the viewport there.
  useEffect(() => {
    const map = mapRef.current
    if (!map || fitToLandmarks) return
    map.setView(center, map.getZoom(), { animate: true })
    meMarkerRef.current?.setLatLng(center)
  }, [center, fitToLandmarks])

  // Rebuild landmark markers whenever the data or selection changes.
  useEffect(() => {
    const map = mapRef.current
    const layer = markerLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    const primary = themeColor("--primary", "oklch(0.52 0.14 39)")
    const accent = themeColor("--accent", "oklch(0.75 0.11 72)")

    for (const lm of landmarks) {
      const visited = visitedIds.has(lm.id)
      const marker = L.marker([lm.lat, lm.lng], {
        icon: pinIcon(visited ? accent : primary, selectedId === lm.id),
      })
        .bindPopup(
          `<strong>${escapeHtml(lm.name)}</strong><br/>${escapeHtml(lm.category ?? "Landmark")}${visited ? " · visited" : ""}`,
        )
        .on("click", () => onSelectRef.current(lm.id))
      layer.addLayer(marker)
    }

    // Frame every pin (e.g. all the places you've visited). maxZoom keeps a
    // lone pin from zooming in too far.
    if (fitToLandmarks && landmarks.length > 0) {
      const bounds = L.latLngBounds(landmarks.map((lm) => [lm.lat, lm.lng] as [number, number]))
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    }
  }, [landmarks, visitedIds, selectedId, fitToLandmarks])

  return <div ref={containerRef} className="waymarks-map h-full w-full" style={{ background: "var(--muted)" }} />
}
