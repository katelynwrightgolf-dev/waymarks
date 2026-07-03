"use client"

import type { Landmark } from "@/lib/landmarks"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useEffect } from "react"
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet"

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

// Read the CSS variables so pins match the active theme.
function useThemeColor(variable: string, fallback: string) {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return value || fallback
}

function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, zoom, { animate: true })
  }, [center, zoom, map])
  return null
}

type MapViewProps = {
  center: [number, number]
  landmarks: Landmark[]
  visitedIds: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function MapView({ center, landmarks, visitedIds, selectedId, onSelect }: MapViewProps) {
  const primary = useThemeColor("--primary", "oklch(0.52 0.14 39)")
  const accent = useThemeColor("--accent", "oklch(0.75 0.11 72)")
  const zoom = 14

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />
      <Recenter center={center} zoom={zoom} />

      {/* Your current location */}
      <CircleMarker
        center={center}
        radius={9}
        pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }}
      >
        <Popup>You are here</Popup>
      </CircleMarker>

      {landmarks.map((lm) => {
        const visited = visitedIds.has(lm.id)
        return (
          <Marker
            key={lm.id}
            position={[lm.lat, lm.lng]}
            icon={pinIcon(visited ? accent : primary, selectedId === lm.id)}
            eventHandlers={{ click: () => onSelect(lm.id) }}
          >
            <Popup>
              <strong>{lm.name}</strong>
              <br />
              {lm.category}
              {visited ? " · visited" : ""}
            </Popup>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
