# Site Protocols / Baustellen-Protokolle

A small web app for the iPhone to write site protocols (meetings, inspections, acceptances, defect reports) and share them as a bilingual German / English PDF.

Built for FTTx site management (project LAHLU01, Lahnau).

## What it does

- **New protocol** with an automatic number, e.g. `LAHLU01-2026-001`
- **Drafts** button under it: protocols without a PDF yet. The start screen lists the finished ones
- Project, type, date, time, location
- Attendees with email (names you used before are suggested, company, role and email are filled in)
- Topics and findings, each marked OK or defect, with a note and photos
- Action items: what, who, by when, with photos
- Remarks
- Finger signatures: pick two signers from the attendees
- **Improve text with AI**: Cloudflare's built-in AI corrects and tidies the texts, you check each change before it is used
- **Create & share PDF**: opens the iPhone share sheet (Mail, WhatsApp, Save to Files)
- **Send by email**: shows the attendees' addresses, a subject and a message you can change, then opens the share sheet where you pick Outlook: the PDF is attached and the message filled in. A web app cannot fill in Outlook's "To" field, so the addresses are copied and you paste them
- Saves automatically on the phone and works without signal

## Plan

1. Form, saving on the phone, PDF ✅
2. Photos and finger signatures ✅
3. Send each finished protocol to Smartsheet (one row per protocol, PDF attached)
4. Extras: follow-up protocol that copies open action items

## Put it online (Cloudflare, one time)

1. Log in at dash.cloudflare.com.
2. Go to **Workers & Pages** → **Create** → **Import a repository**.
3. Pick the GitHub repository `site-protocols`.
4. Leave the settings as they are (deploy command `npx wrangler deploy`) and tap **Deploy**.
5. You get an address like `https://site-protocols.<your-name>.workers.dev`.

From then on, every change on the `main` branch goes online automatically.

## "Improve text with AI"

Works without any setup: the texts go to Cloudflare's own AI (model Llama 3.3 70B). No extra account, no key, free.

- **Free amount:** Cloudflare allows about 10,000 "neurons" per day for free, which is enough for dozens of protocols. It resets every night (midnight UTC). On the free Cloudflare plan you are never charged; when the amount is used up, the app says so and it works again the next day.
- **Nothing changes by itself:** you see every suggestion and tap **Übernehmen / Apply** for the ones you want.

Optional extras (Cloudflare → **Workers & Pages** → `site-protocols` → **Settings** → **Variables and Secrets** → add a **Secret**):

| Secret | What it does |
|---|---|
| `APP_KEY` | A password you make up. Stops strangers who find your web address from using your AI allowance. Enter the same password in the app under ⚙︎ → **KI / AI**. |
| `ANTHROPIC_API_KEY` | A Claude API key from console.anthropic.com (needs paid credit). The app then uses Claude instead of Cloudflare's AI, for better wording. |

## Install on the iPhone

1. Open the address in **Safari**.
2. Tap the **Share** button, then **Add to Home Screen**.
3. Open it from the home screen icon. Tap ⚙︎ and enter your name, company and projects once.

Your protocols are stored only on this iPhone until step 3 (Smartsheet) is built. Deleting the app icon deletes them, so share the PDFs you need.

## Files

| File | What it is |
|---|---|
| `public/index.html` | The screens |
| `public/app.js` | The app logic and the PDF layout |
| `public/style.css` | Colors and layout |
| `public/sw.js` | Offline support. Raise the `CACHE` version after changes |
| `public/vendor/jspdf.umd.min.js` | PDF library (jsPDF 4.2.1, MIT license) |
| `src/index.js` | Cloudflare Worker: the AI text check, and Smartsheet later |
| `wrangler.jsonc` | Cloudflare settings |

## Try it on a computer

```
npm install
npm run dev
```

Then open http://localhost:8787.
