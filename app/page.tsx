import { getVisits } from "@/app/actions/visits"
import { LandmarkTracker } from "@/components/landmark-tracker"
import { MapPinned } from "lucide-react"

export default async function HomePage() {
  const initialVisits = await getVisits()

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 pb-16 pt-6">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <MapPinned className="size-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-serif text-2xl font-semibold leading-tight text-foreground">Waymarks</h1>
          <p className="text-sm text-muted-foreground">Historic stops from the road</p>
        </div>
      </header>

      <LandmarkTracker initialVisits={initialVisits} />

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        Landmark data from OpenStreetMap contributors
      </footer>
    </main>
  )
}
