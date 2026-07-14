import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"

export const maxDuration = 30

type FactsRequest = {
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
        "You are a knowledgeable local historian and tour guide. " +
        "Given a place, share genuinely interesting, specific, and lesser-known facts about it: " +
        "its history, architecture, notable people or events, and cultural significance. " +
        "Rules: Only state facts you are confident are accurate — never invent details. " +
        "If you are unsure about a specific place, share interesting context about its type, era, or region instead of guessing. " +
        "Return exactly 3 to 4 facts. Each fact must be a single concise sentence (max ~30 words). " +
        "Return ONLY the facts, one per line, with no numbering, bullets, headers, or preamble.",
      prompt:
        `Tell me interesting facts about this ${kind}: "${name}".` +
        (context ? `\n\n${context}` : ""),
    })

    const facts = text
      .split("\n")
      .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
      .filter((line) => line.length > 0)

    if (facts.length === 0) {
      return Response.json({ error: "No facts were generated. Please try again." }, { status: 502 })
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
