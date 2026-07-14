import { searchLandmarksByName } from "@/lib/landmarks"
import { NextResponse } from "next/server"

// Search for a specific landmark by name (anywhere), so users can log a place
// they're walking past even if it wasn't in the nearby list. Optional lat/lng
// lets us sort matches by distance from the user.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim()
  if (!q) {
    return NextResponse.json({ landmarks: [] })
  }

  const latRaw = searchParams.get("lat")
  const lngRaw = searchParams.get("lng")
  const lat = latRaw != null ? Number.parseFloat(latRaw) : NaN
  const lng = lngRaw != null ? Number.parseFloat(lngRaw) : NaN
  const near = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined

  try {
    const landmarks = await searchLandmarksByName(q, near)
    return NextResponse.json({ landmarks })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed", landmarks: [] },
      { status: 500 },
    )
  }
}
