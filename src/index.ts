/**
 * crawlertoll-cloudflare-template — Cloudflare Workers entrypoint.
 *
 * One file. One deploy command. AI-crawler enforcement at Cloudflare's
 * edge without needing a Cloudflare Enterprise plan.
 *
 * What this Worker does on every request:
 *
 *   1. Detect AI crawlers (curated UA catalogue, Web Bot Auth signature
 *      header presence, signature-agent header).
 *   2. Verify cryptographic identity if the request is signed (Ed25519
 *      + RFC 9421 HTTP Message Signatures per IETF draft-meunier-05).
 *   3. Apply your RSL 1.0 robots.txt policy.
 *   4. Issue a 402 with Cloudflare-shape Crawler-Price headers + a
 *      structured JSON payment offer when policy says so; 403 when
 *      blocked; 200 when allowed.
 *   5. Forward allowed requests to your route handlers.
 *
 * Plus, two well-known endpoints the AI agents look for:
 *
 *   GET /robots.txt                     → RSL 1.0 policy
 *   GET /.well-known/context-license.json → buyer-side discovery
 *
 * Edit `src/policy.ts` to customise. Deploy with `wrangler deploy`.
 */

import { Hono } from "hono";

import { crawlertoll, type CrawlerTollVariables } from "@crawlertoll/hono";

import { CONTEXT_LICENSE, OFFER, ROBOTS_TXT } from "./policy.js";

type Env = {
  Variables: CrawlerTollVariables;
};

const app = new Hono<Env>();

// ─── 1. Always-allow the discovery files ───────────────────────────
//
// These endpoints must be reachable by every crawler — they are *how*
// the crawler decides whether to pay. Wire them BEFORE the enforcement
// middleware so they never get 402'd.

app.get("/robots.txt", (c) => {
  return new Response(ROBOTS_TXT, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
});

app.get("/.well-known/context-license.json", (c) => {
  return c.json(CONTEXT_LICENSE, 200, {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
  });
});

// ─── 2. CrawlerToll enforcement on every other route ───────────────

app.use(
  "*",
  crawlertoll({
    offer: OFFER,
    policy: ROBOTS_TXT,
    contextLicenseUrl: "/.well-known/context-license.json",
    termsUrl: CONTEXT_LICENSE.terms_of_use,
    onDecision: (decision, c) => {
      // Cloudflare-friendly: non-blocking telemetry via waitUntil.
      // Replace this console.log with your real metrics sink.
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          path: new URL(c.req.url).pathname,
          ua: c.req.header("user-agent")?.slice(0, 80),
          action: decision.action,
          operator: decision.bot.entry?.operator ?? null,
          verified: decision.authVerified?.valid ?? null,
        }),
      );
    },
  }),
);

// ─── 3. Your routes ─────────────────────────────────────────────────

app.get("/", (c) =>
  c.text(
    "OK — this Worker is alive.\n\n" +
      "Try:\n" +
      "  curl -H 'user-agent: GPTBot/1.2' <this-worker>/api/articles\n" +
      "  → 402 with Crawler-Price header + structured offer\n\n" +
      "  curl <this-worker>/api/articles\n" +
      "  → 200 with sample JSON\n",
  ),
);

app.get("/api/articles", (c) => {
  return c.json({
    articles: [
      { id: 1, title: "Example article one" },
      { id: 2, title: "Example article two" },
    ],
    decision: c.var.crawlertoll?.action,
  });
});

app.get("/api/articles/:id", (c) => {
  return c.json({
    id: c.req.param("id"),
    title: `Example article ${c.req.param("id")}`,
    decision: c.var.crawlertoll?.action,
  });
});

// Sample public path that bypasses the per-crawl charge per the RSL
// `Allow: /public` directive in src/policy.ts.
app.get("/public/preview", (c) =>
  c.json({ preview: "free preview content; full articles require payment" }),
);

// ─── 4. Catch-all 404 ───────────────────────────────────────────────

app.notFound((c) =>
  c.json(
    {
      error: "not_found",
      message: "Try /, /api/articles, /api/articles/1, or /public/preview.",
    },
    404,
  ),
);

// ─── 5. Default export — Workers runtime fetches this ──────────────

export default app;
