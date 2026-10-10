// The Cloudflare Worker. Right now it only answers /api/health.
// In step 3 it will send finished protocols to Smartsheet,
// so the Smartsheet API token stays secret here and never goes to the phone.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Anything else: the app files from /public.
    return env.ASSETS.fetch(request);
  },
};
