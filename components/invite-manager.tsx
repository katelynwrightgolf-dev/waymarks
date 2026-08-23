"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Check, Copy, Loader2, Plus, Share2, Ticket, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createInvite, revokeInvite } from "@/app/actions/invites"

type Invite = {
  id: number
  code: string
  label: string | null
  usedByUserId: string | null
  usedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export function InviteManager({ initialInvites }: { initialInvites: Invite[] }) {
  const [invites, setInvites] = useState(initialInvites)
  const [label, setLabel] = useState("")
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const signUpUrl = typeof window !== "undefined" ? `${window.location.origin}/sign-up` : "/sign-up"

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    try {
      const row = await createInvite(label)
      if (row) setInvites((prev) => [row as Invite, ...prev])
      setLabel("")
    } finally {
      setPending(false)
    }
  }

  async function handleRevoke(id: number) {
    setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, revokedAt: new Date() } : i)))
    await revokeInvite(id)
  }

  async function handleShare(code: string) {
    const message = `Join me on Waymarks. Go to ${signUpUrl} and use invite code ${code}`
    // Native share sheet on phones; clipboard everywhere else.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Waymarks invite", text: message })
        return
      } catch {
        // User dismissed the sheet -- fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(message)
      setCopied(code)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard blocked; the code is visible on screen to copy manually.
    }
  }

  const active = invites.filter((i) => !i.usedByUserId && !i.revokedAt)
  const used = invites.filter((i) => i.usedByUserId)

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 pb-16 pt-6">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href="/"
          aria-label="Back to your log"
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-card-foreground"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold leading-tight">Invite people</h1>
          <p className="text-sm text-muted-foreground">Each code works once. Everyone gets their own log.</p>
        </div>
      </header>

      <form onSubmit={handleCreate} className="mb-8 flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <label htmlFor="label" className="text-sm font-medium text-card-foreground">
          Who is this for? <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Mom, Dave, road trip crew..."
          className="min-h-11 rounded-lg border border-border bg-background px-3 text-base text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-primary"
        />
        <Button type="submit" disabled={pending} className="min-h-11 w-full text-base">
          {pending ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="mr-2 size-4" aria-hidden="true" />
          )}
          Create invite code
        </Button>
      </form>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Ready to send ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No unused codes yet. Create one above.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-lg font-semibold tracking-widest text-card-foreground">{inv.code}</p>
                    {inv.label && <p className="truncate text-sm text-muted-foreground">For {inv.label}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(inv.id)}
                    aria-label={`Revoke code ${inv.code}`}
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleShare(inv.code)}
                  className="min-h-11 w-full bg-transparent text-base"
                >
                  {copied === inv.code ? (
                    <>
                      <Check className="mr-2 size-4" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Share2 className="mr-2 size-4" aria-hidden="true" />
                      Share invite
                    </>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {used.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Already joined ({used.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {used.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 text-sm"
              >
                <Ticket className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-mono text-muted-foreground line-through">{inv.code}</span>
                {inv.label && <span className="truncate text-muted-foreground">{inv.label}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 rounded-xl bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Send someone the code plus this link: <span className="break-all font-medium">{signUpUrl}</span>. They pick
        their own username and password, and their check-ins stay separate from yours.
      </p>
    </main>
  )
}
