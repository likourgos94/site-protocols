// The Cloudflare Worker: serves the app and answers /api/... requests.
// Secrets (set in Cloudflare, never on the phone):
//   APP_KEY            a password you choose; the app sends it with every AI request
//   ANTHROPIC_API_KEY  your Claude API key, used for "Improve text with AI"

import Anthropic from "@anthropic-ai/sdk";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/polish" && request.method === "POST") {
      return polish(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Anything else: the app files from /public.
    return env.ASSETS.fetch(request);
  },
};

// ---------- "Improve text with AI" ----------

const MAX_INPUT_CHARS = 30000; // keeps a single request (and its cost) small

const SYSTEM_PROMPT = `You edit the texts of a construction site protocol (Baustellenprotokoll) written by a site manager for FTTx fibre-optic projects in Germany. The texts are short notes typed on a phone on site.

For every text:
- Correct spelling, grammar and punctuation.
- Make the wording clear, short and professional, in the usual style of a German site protocol. Keep notes as notes; do not turn them into long sentences.
- Keep every fact exactly: numbers, measurements, addresses, house numbers, names, companies, dates and technical terms.
- Do not add information, opinions or recommendations that are not in the text.
- Keep the language the text is written in. German stays German, English stays English, mixed stays mixed.
- An empty text stays empty.

Return the same number of items in the same order.`;

// Shape of both the request and the answer.
const TEXTS_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, note: { type: "string" } },
        required: ["title", "note"],
        additionalProperties: false,
      },
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
        additionalProperties: false,
      },
    },
    remarks: { type: "string" },
  },
  required: ["topics", "actions", "remarks"],
  additionalProperties: false,
};

async function polish(request, env) {
  if (!env.APP_KEY || !env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  if (!(await sameText(request.headers.get("X-App-Key") || "", env.APP_KEY))) {
    return Response.json({ error: "wrong_key" }, { status: 401 });
  }

  let texts;
  try {
    texts = cleanTexts(await request.json());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const input = JSON.stringify(texts);
  if (input.length > MAX_INPUT_CHARS) {
    return Response.json({ error: "too_long" }, { status: 413 });
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if a request is declined, Anthropic retries it on its recommended model
      output_config: {
        effort: "low", // proofreading is simple work; low keeps it fast and cheap
        format: { type: "json_schema", schema: TEXTS_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: input }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "ai_key_invalid" }, { status: 502 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "ai_busy" }, { status: 503 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: "ai_error", status: error.status }, { status: 502 });
    }
    return Response.json({ error: "ai_unreachable" }, { status: 502 });
  }

  if (response.stop_reason !== "end_turn") {
    return Response.json({ error: "ai_incomplete", reason: response.stop_reason }, { status: 502 });
  }
  const text = response.content.find((block) => block.type === "text")?.text;
  let improved;
  try {
    improved = cleanTexts(JSON.parse(text));
  } catch {
    return Response.json({ error: "ai_bad_answer" }, { status: 502 });
  }
  if (improved.topics.length !== texts.topics.length || improved.actions.length !== texts.actions.length) {
    return Response.json({ error: "ai_bad_answer" }, { status: 502 });
  }
  return Response.json(improved);
}

// Keeps only the expected fields, all as strings.
function cleanTexts(data) {
  const str = (v) => (typeof v === "string" ? v : "");
  if (!data || !Array.isArray(data.topics) || !Array.isArray(data.actions)) throw new Error("bad shape");
  return {
    topics: data.topics.map((t) => ({ title: str(t?.title), note: str(t?.note) })),
    actions: data.actions.map((a) => ({ task: str(a?.task) })),
    remarks: str(data.remarks),
  };
}

// Compares two strings without leaking how much of them matched.
async function sameText(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}
