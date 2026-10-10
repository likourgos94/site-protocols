# Site Protocols / Baustellen-Protokolle

A small web app for the iPhone to write site protocols (meetings, inspections, acceptances, defect reports) and share them as a bilingual German / English PDF.

Built for FTTx site management (project LAHLU01, Lahnau).

## What it does

- **New protocol** with an automatic number, e.g. `LAHLU01-2026-001`
- Project, type, date, time, location
- Attendees (names you used before are suggested, company and role are filled in)
- Topics and findings, each marked OK or defect, with a note and photos
- Action items: what, who, by when, with photos
- Remarks
- Finger signatures: pick two signers from the attendees
- **Improve text with AI**: Claude corrects and tidies the texts, you check each change before it is used
- **Create & share PDF**: opens the iPhone share sheet (Mail, WhatsApp, Save to Files)
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

## Turn on "Improve text with AI" (one time)

1. Get a Claude API key at console.anthropic.com (**API Keys** → **Create Key**) and add some credit under **Billing**.
2. In Cloudflare, open **Workers & Pages** → `site-protocols` → **Settings** → **Variables and Secrets** and add two **Secrets**:
   - `ANTHROPIC_API_KEY`: the Claude API key
   - `APP_KEY`: a password you make up (it stops strangers from using your API key)
3. In the app, tap ⚙︎ and enter the same `APP_KEY` under **KI / AI**.

The texts are sent through your Cloudflare Worker to Claude (model `claude-opus-5-5`). Nothing is changed until you tap **Übernehmen / Apply**.

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
