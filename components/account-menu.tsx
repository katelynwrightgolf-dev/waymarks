"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Fingerprint, LogOut, Ticket, User } from "lucide-react"

import { authClient } from "@/lib/auth-client"

export function AccountMenu({ username, isOwner = false }: { username: string; isOwner?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside tap -- important on touch where there's no blur.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/sign-in")
    router.refresh()
  }

  async function handleAddPasskey() {
    setStatus(null)
    try {
      const res = await authClient.passkey.addPasskey()
      setStatus(res?.error ? "Couldn't add a passkey on this device." : "Passkey added.")
    } catch {
      setStatus("Passkeys aren't supported on this device.")
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${username}`}
        className="flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-card-foreground"
      >
        <User className="size-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-13 z-50 flex w-56 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium text-card-foreground">{username}</p>
            <p className="text-xs text-muted-foreground">Your private log</p>
          </div>

          {isOwner && (
            <Link
              href="/invites"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center gap-3 px-4 text-sm text-card-foreground hover:bg-muted"
            >
              <Ticket className="size-4" aria-hidden="true" />
              Invite people
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={handleAddPasskey}
            className="flex min-h-11 items-center gap-3 px-4 text-left text-sm text-card-foreground hover:bg-muted"
          >
            <Fingerprint className="size-4" aria-hidden="true" />
            Add a passkey
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex min-h-11 items-center gap-3 border-t border-border px-4 text-left text-sm text-card-foreground hover:bg-muted"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>

          {status && (
            <p role="status" className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
