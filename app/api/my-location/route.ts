import { NextResponse } from "next/server"

// Detect the visitor's approximate location on the SERVER, where there are no
// cross-origin iframe restrictions that block the browser Geolocation API or
// client-side IP lookups (the reason auto-detect fails inside the v0 preview).
//
// Strategy:
//   1. Use Vercel's edge geo headers — present on the deployed/published app.
//   2. Fall back to a server-side IP geolocation lookup using the visitor's IP.
export async function GET(request: Request) {
  const h = request.headers

  // 1) Vercel geolocation headers (available on Vercel deployments).
  const vLat = h.get("x-vercel-ip-latitude")
  const vLng = h.get("x-vercel-ip-longitude")
  if (vLat && vLng) {
    const city = decodeHeader(h.get("x-vercel-ip-city"))
    const region = h.get("x-vercel-ip-country-region")
    const label = [city, region].filter(Boolean).join(", ")
    return NextResponse.json({
      lat: Number.parseFloat(vLat),
      lng: Number.parseFloat(vLng),
      label: label ? `${label} (approx.)` : "Approximate location",
      source: "vercel",
    })
  }

  // 2) Server-side IP geolocation fallback.
  const ip = clientIp(h)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    // ipwho.is allows a specific IP path and works without a key. When the IP
    // is empty/local, the service geolocates the caller (our server) — still a
    // reasonable best effort; the manual search covers the rest.
    const url = ip ? `https://ipwho.is/${encodeURIComponent(ip)}` : "https://ipwho.is/"
    const res = await fetch(url, { signal: controller.signal })
    if (res.ok) {
      const data = (await res.json()) as {
        success?: boolean
        latitude?: number
        longitude?: number
        city?: string
        region?: string
      }
      if (data.success !== false && typeof data.latitude === "number") {
        const label = [data.city, data.region].filter(Boolean).join(", ")
        return NextResponse.json({
          lat: data.latitude,
          lng: data.longitude,
          label: label ? `${label} (approx.)` : "Approximate location",
          source: "ip",
        })
      }
    }
  } catch {
    /* fall through to the error below */
  } finally {
    clearTimeout(timer)
  }

  return NextResponse.json(
    { error: "Couldn't detect your location automatically." },
    { status: 404 },
  )
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null
  try {
    // Vercel city headers are URL-encoded (e.g. "New%20York").
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function clientIp(h: Headers): string | null {
  const forwarded = h.get("x-forwarded-for")
  if (forwarded) {
    // First entry is the original client IP.
    const first = forwarded.split(",")[0]?.trim()
    if (first && !isPrivateIp(first)) return first
  }
  const real = h.get("x-real-ip")
  if (real && !isPrivateIp(real)) return real
  return null
}

function isPrivateIp(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("100.64.") // carrier-grade NAT / sandbox internal
  )
}
