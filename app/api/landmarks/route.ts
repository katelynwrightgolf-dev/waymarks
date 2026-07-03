import { fetchNearbyLandmarks } from "@/lib/landmarks"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = Number.parseFloat(searchParams.get("lat") ?? "")
  const lng = Number.parseFloat(searchParams.get("lng") ?? "")
  const radius = Math.min(Math.max(Number.parseInt(searchParams.get("radius") ?? "3000", 10), 500), 20000)

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "Missing or invalid lat/lng" }, { status: 400 })
  }

  try {
    const landmarks = await fetchNearbyLandmarks(lat, lng, radius)
    return NextResponse.json({ landmarks })
  } catch (err) {
    console.log("[v0] landmark fetch error:", err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: "Could not reach OpenStreetMap right now. Please try again." },
      { status: 502 },
    )
  }
}
