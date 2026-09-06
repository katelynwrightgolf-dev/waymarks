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
    let facts = await generateFacts(name, kind, context)

    // The model sometimes responds to an unfamiliar place by asking for more
    // detail instead of answering. That reads as "it doesn't know" in the UI,
    // so retry once with a forceful instruction to work from what it has.
    if (facts.length < 2) {
      console.log("[v0] facts looked like a refusal, retrying:", name)
      facts = await generateFacts(name, kind, context, true)
    }

    if (facts.length === 0) {
      return Response.json(
        { error: "No stories turned up for this spot. It may just be too new or too quiet to have a story yet." },
        { status: 200 },
      )
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

// Phrases that signal the model is hedging or asking the user for more input
// rather than actually sharing a fact. Checked against the whole response, so a
// refusal split across a preamble and a bulleted "please provide" list is
// caught even when individual bullet fragments look innocent on their own.
const REFUSAL_CUE =
  /\b(i don'?t have|i do not have|i couldn'?t find|i can'?t (?:reliably|confidently|find)|i cannot|i'?m not able|i am not able|could you (?:provide|tell|share)|please provide|if you (?:could|can) provide|without (?:knowing|more)|too vague|need more (?:info|context|details)|not enough (?:info|information)|i appreciate|i risk (?:stating|inventing)|to give you|would allow me|i'?d be (?:happy|better)|with those details|i'?ll deliver|i need (?:to|more))\b/i

async function generateFacts(
  name: string,
  kind: string,
  context: string,
  forceful = false,
): Promise<string[]> {
  const { text } = await generateText({
    // Claude via your own Anthropic account. The provider reads its key from
    // ANTHROPIC_API_KEY, so usage bills directly to Anthropic. Haiku is fast
    // and cheap for short facts.
    model: anthropic("claude-haiku-4-5"),
    system:
      "You are a captivating local historian who specializes in the dramatic, surprising, and unforgettable side of history. " +
      "Given a place, surface its most fascinating and lesser-known stories — the kind that make people say 'I had no idea.' " +
      "When a Background section is provided, treat it as authoritative and mine it for the most vivid details. " +
      "Prioritize the dramatic and memorable: crimes, deaths, duels, disasters, scandals, hauntings and ghost lore, secret tunnels, " +
      "buried treasure, notorious figures, riots, fires, strange rituals, and wild twists of fate. " +
      "Also welcome: shocking origins, bizarre trivia, and record-setting or 'first ever' claims. " +
      "Lead with the single most surprising or dramatic fact. " +
      "CRITICAL: Only state things you are genuinely confident are true — never invent or exaggerate a death, crime, or event. " +
      "Accuracy always wins over drama. Clearly frame local legends or ghost stories as legend rather than fact. " +
      "If you don't know dramatic specifics about this exact place, draw on the Background, or on striking true history of its era, " +
      "region, or type of place. " +
      "ABSOLUTELY FORBIDDEN: never ask the user for more information, never say you lack information or can't identify the place, " +
      "never add preamble, questions, disclaimers, or meta-commentary. Output facts only. " +
      "Return exactly 3 to 5 facts. Each fact is a single vivid, self-contained sentence (max ~35 words). " +
      "Return ONLY the facts, one per line, with no numbering, bullets, headers, or preamble.",
    prompt:
      (forceful
        ? `Share 3 to 5 vivid, true historical facts connected to this ${kind}: "${name}". ` +
          `Do NOT ask for details or say you are unsure — if you lack specifics about this exact place, use the Background below and ` +
          `the real history of its era, region, and type of place. Every line must be a fact, never a question.`
        : `Tell me the most interesting and dramatic true stories about this ${kind}: "${name}". ` +
          `Include anything shocking — like if someone died or was killed there, a famous crime or scandal, a disaster, or a haunting.`) +
      (context ? `\n\n${context}` : ""),
  })

  // If the response as a whole reads like a refusal or a request for more
  // detail, discard it entirely rather than salvaging stray bullet fragments.
  if (REFUSAL_CUE.test(text)) return []

  return text
    .split("\n")
    .map((line) => line.trim())
    // Drop markdown headings (e.g. "# Roseland Theater") the model sometimes
    // adds as a title — those aren't facts.
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    // Strip any leading bullet/number markers.
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    // A stray question line is never a fact.
    .filter((line) => line.length > 0 && !line.endsWith("?"))
}
