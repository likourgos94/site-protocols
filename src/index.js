// The Cloudflare Worker: serves the app and answers /api/... requests.
// "Improve text with AI" uses Cloudflare's own AI (the AI binding in wrangler.jsonc),
// so it works without any key. Optional secrets (set in Cloudflare, never on the phone):
//   APP_KEY            a password you choose; if set, the app must send it with every AI request
//   ANTHROPIC_API_KEY  a Claude API key; if set, Claude is used instead of Cloudflare's AI

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

// Cloudflare's free model for German and English text, with JSON answers.
const CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Keeps a single request small. Cloudflare's model reads less text at once than Claude.
const MAX_INPUT_CHARS = { cloudflare: 12000, claude: 30000 };

const SYSTEM_PROMPT = `You edit the texts of a construction site protocol (Baustellenprotokoll) written by a site manager for FTTx fibre-optic projects in Germany. The texts are short notes typed on a phone on site.

For every text:
- Correct spelling, grammar and punctuation.
- Make the wording clear, short and professional, in the usual style of a German site protocol. Keep notes as notes; do not turn them into long sentences.
- Keep every fact exactly: numbers, measurements, addresses, house numbers, names, companies, dates and technical terms.
- Do not add information, opinions or recommendations that are not in the text.
- Keep the language the text is written in. German stays German, English stays English, mixed stays mixed.
- An empty text stays empty.

The texts come as JSON. Answer with JSON of exactly the same shape: the same number of items in the same order.`;

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
  const engine = env.ANTHROPIC_API_KEY ? "claude" : env.AI ? "cloudflare" : null;
  if (!engine) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  // The password is only checked if one is set in Cloudflare.
  if (env.APP_KEY && !(await sameText(request.headers.get("X-App-Key") || "", env.APP_KEY))) {
    return Response.json({ error: "wrong_key" }, { status: 401 });
  }

  let texts;
  try {
    texts = cleanTexts(await request.json());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const input = JSON.stringify(texts);
  if (input.length > MAX_INPUT_CHARS[engine]) {
    return Response.json({ error: "too_long" }, { status: 413 });
  }

  const answer = engine === "claude" ? await askClaude(input, env) : await askCloudflare(input, env);
  if (answer.error) {
    return Response.json(answer, { status: answer.status || 502 });
  }
  let improved;
  try {
    improved = cleanTexts(answer.data);
  } catch {
    return Response.json({ error: "ai_bad_answer" }, { status: 502 });
  }
  if (improved.topics.length !== texts.topics.length || improved.actions.length !== texts.actions.length) {
    return Response.json({ error: "ai_bad_answer" }, { status: 502 });
  }
  return Response.json(improved);
}

// Cloudflare Workers AI: no key needed. Free for about 10,000 "neurons" a day
// (resets at midnight UTC), which is many protocols.
async function askCloudflare(input, env) {
  let result;
  try {
    result = await env.AI.run(CLOUDFLARE_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
      response_format: { type: "json_schema", json_schema: TEXTS_SCHEMA },
      max_tokens: 6000, // the default is only 256, too short for a whole protocol
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/3036|neuron|daily/i.test(message)) { // the free daily allowance is used up
      return { error: "ai_daily_limit", status: 429 };
    }
    if (/json/i.test(message)) {
      return { error: "ai_bad_answer" };
    }
    return { error: "ai_error", detail: message.slice(0, 200) };
  }
  const answer = result?.response;
  try {
    return { data: typeof answer === "string" ? JSON.parse(answer) : answer };
  } catch {
    return { error: "ai_bad_answer" };
  }
}

// Claude (Anthropic): better wording, needs ANTHROPIC_API_KEY and paid API credit.
async function askClaude(input, env) {
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
      return { error: "ai_key_invalid" };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { error: "ai_busy", status: 503 };
    }
    if (error instanceof Anthropic.APIError) {
      return { error: "ai_error", status: 502, detail: `Claude ${error.status}` };
    }
    return { error: "ai_unreachable" };
  }

  if (response.stop_reason !== "end_turn") {
    return { error: "ai_incomplete", reason: response.stop_reason };
  }
  const text = response.content.find((block) => block.type === "text")?.text;
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: "ai_bad_answer" };
  }
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
