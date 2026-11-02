"use client"

import { useEffect } from "react"

// Registers public/sw.js so the app can open with no signal. Production only:
// in development (and the v0 preview) a service worker would serve stale code.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])
  return null
}
