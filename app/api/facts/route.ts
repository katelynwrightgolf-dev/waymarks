import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { getCachedFacts, saveFacts } from "@/lib/facts-store"

export const maxDuration = 30

type FactsRequest = {
  landmarkId?: string
  name?: string
  category?: string | null
  kind?: "town" | "landmark"
  description?: string | null
  locationLabel?: string | null
}

export async function POST(request: Request) {
  let body: FactsRequest
  try {
    body = (await request.json()) as FactsRequest
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 })
  }

  const name = body.name?.trim()
  if (!name) {
    return Response.json({ error: "A landmark name is required." }, { status: 400 })
  }

  const landmarkId = body.landmarkId?.trim()

  // Return persisted facts if we've already generated them for this landmark,
  // so we never pay to generate the same facts twice.
  if (landmarkId) {
    try {
      const cached = await getCachedFacts(landmarkId)
      if (cached && cached.length > 0) {
        return Response.json({ facts: cached, cached: true })
      }
    } catch (error) {
      console.log("[v0] facts cache read error:", error instanceof Error ? error.message : error)
    }
  }

  const kind = body.kind === "town" ? "town or community" : "historic landmark"
  const context = [
    body.category ? `Category: ${body.category}` : null,
    body.locationLabel ? `Located near: ${body.locationLabel}` : null,
    body.description ? `Background: ${body.description}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const { text } = await generateText({
      // Claude via your own Anthropic account. The provider reads your key from
      // the ANTHROPIC_API_KEY env var, so usage bills directly to Anthropic
      // (not the Vercel AI Gateway). Haiku is fast and cheap for short facts.
      model: anthropic("claude-haiku-4-5"),
      system:
        "You are a captivating local historian who specializes in the dramatic, surprising, and unforgettable side of history. " +
        "Given a place, surface its most fascinating and lesser-known stories — the kind that make people say 'I had no idea.' " +
        "Prioritize the dramatic and memorable: crimes, deaths, duels, disasters, scandals, hauntings and ghost lore, secret tunnels, " +
        "buried treasure, notorious figures, riots, fires, strange rituals, and wild twists of fate. " +
        "Also welcome: shocking origins, bizarre trivia, and record-setting or 'first ever' claims. " +
        "Lead with the single most surprising or dramatic fact. " +
        "CRITICAL: Only state things you are genuinely confident are true — never invent or exaggerate a death, crime, or event. " +
        "Accuracy always wins over drama. If you don't know something dramatic about this exact place, share the most vivid true facts " +
        "you do know, or striking real history from its era, region, or type of place instead of guessing. " +
        "Clearly frame local legends or ghost stories as legend rather than fact. " +
        "Return exactly 3 to 5 facts. Each fact is a single vivid sentence (max ~35 words). " +
        "Return ONLY the facts, one per line, with no numbering, bullets, headers, or preamble.",
      prompt:
        `Tell me the most interesting and dramatic true stories about this ${kind}: "${name}". ` +
        `Include anything shocking — like if someone died or was killed there, a famous crime or scandal, a disaster, or a haunting.` +
        (context ? `\n\n${context}` : ""),
    })

    const facts = text
      .split("\n")
      .map((line) => line.trim())
      // Drop markdown headings (e.g. "# Roseland Theater") the model sometimes
      // adds as a title — those aren't facts.
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      // Strip any leading bullet/number markers.
      .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
      .filter((line) => line.length > 0)

    if (facts.length === 0) {
      return Response.json({ error: "No facts were generated. Please try again." }, { status: 502 })
    }

    // Persist so future requests for this landmark are free and instant.
    if (landmarkId) {
      try {
        await saveFacts(landmarkId, facts)
      } catch (error) {
        console.log("[v0] facts cache write error:", error instanceof Error ? error.message : error)
      }
    }

    return Response.json({ facts })
  } catch (error) {
    console.log("[v0] facts generation error:", error instanceof Error ? error.message : error)
    return Response.json(
      { error: "Could not generate facts right now. Please try again." },
      { status: 500 },
    )
  }
}
