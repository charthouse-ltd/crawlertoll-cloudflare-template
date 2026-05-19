# crawlertoll-cloudflare-template

**Fork-and-deploy Cloudflare Workers template for the AI-crawler economy.** Detect AI crawlers, verify Web Bot Auth, apply RSL 1.0 policy, and issue HTTP 402 with a structured payment offer — at Cloudflare's edge, on the free Workers tier, **with no Cloudflare Enterprise plan required**.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nhrzxxw9dn-web/crawlertoll-cloudflare-template)

- **License**: Apache-2.0
- **Runtime**: Cloudflare Workers (free tier — 100k req/day, plenty for most sites)
- **Stack**: [Hono](https://hono.dev) + [`@crawlertoll/hono`](https://www.npmjs.com/package/@crawlertoll/hono) + [`@crawlertoll/core`](https://www.npmjs.com/package/@crawlertoll/core)
- **Bundle size**: 145 KB raw, **37 KB gzipped** (well under CF's 1 MiB Worker limit)
- **Cold start**: <5 ms

---

## What this Worker does

On every incoming request:

1. **Detect** AI crawlers via the curated `@crawlertoll/core` catalogue (30+ operators — GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended, Meta-ExternalAgent, Bytespider, CCBot, Cohere, Mistral, etc.).
2. **Verify** cryptographic identity if the request carries Web Bot Auth signatures (Ed25519 + RFC 9421 HTTP Message Signatures per IETF `draft-meunier-web-bot-auth-architecture-05`).
3. **Apply** your RSL 1.0 robots.txt policy.
4. **Issue** HTTP 402 with Cloudflare-shape `Crawler-Price` / `Crawler-Price-Rail` / `Link` headers + a structured JSON payment offer, OR 403 when policy says block, OR 200 when allowed.
5. **Forward** allowed requests to your route handlers.

Plus two well-known endpoints AI agents look for:

```
GET /robots.txt                       →  RSL 1.0 policy (default catch-all)
GET /.well-known/context-license.json →  buyer-side discovery metadata
```

---

## Sixty-second deploy

```bash
# 1. Clone
git clone https://github.com/nhrzxxw9dn-web/crawlertoll-cloudflare-template my-worker
cd my-worker

# 2. Install
npm install

# 3. Authenticate (one-time)
npx wrangler login

# 4. Edit src/policy.ts to set your domain, pricing, and policy

# 5. Ship
npx wrangler deploy
```

You'll get a `<worker-name>.<your-subdomain>.workers.dev` URL. Custom domain takes one more click in the Cloudflare dashboard.

---

## Test the deployed Worker

```bash
WORKER=https://crawlertoll-worker.<your-subdomain>.workers.dev

# Browser — passes through.
curl -s "$WORKER/api/articles" | jq

# AI crawler — gets 402 with structured offer.
curl -sI -H 'user-agent: GPTBot/1.2' "$WORKER/api/articles"
# expect:
#   HTTP/2 402
#   crawler-price: 5000 micros USD
#   crawler-price-rail: x402
#   link: <...>; rel="describedby", <...>; rel="terms-of-service"
#   retry-after: 60

curl -s -H 'user-agent: GPTBot/1.2' "$WORKER/api/articles" | jq
# expect:
#   { "error": "payment_required", "offer": { ... } }

# Same crawler hits the Allow-listed public path — 200.
curl -s -H 'user-agent: GPTBot/1.2' "$WORKER/public/preview" | jq
```

---

## Customisation

The whole policy lives in [`src/policy.ts`](./src/policy.ts) — three exports:

```ts
export const OFFER: PaymentOffer = {
  rail: "x402",            // or "tollbit" / "skyfire" / "cloudflare-ppc" / "stripe-acp"
  priceMicros: 5_000,      // 5,000 micros = $0.005 per crawl
  currency: "USD",
  publisher: "example",
  endpoint: "default",
};

export const ROBOTS_TXT = `
User-agent: GPTBot
Disallow: /
Allow: /public
License: https://example.com/ai-license
Permits: ai-search, rag
Prohibits: ai-training, redistribution-without-attribution
Compensation: per-crawl 5000 micros USD
Standard: RSL/1.0

User-agent: *
Disallow:
`;

export const CONTEXT_LICENSE = {
  publisher: { name: "...", slug: "...", domain: "...", contact: "..." },
  endpoints: [{ name: "...", url: "...", transport: "streamable-http", description: "..." }],
  pricing:   { model: "per_query", currency: "USD", unit_price_micros: 5_000 },
  terms_of_use: "https://example.com/ai-terms",
  /* ... */
};
```

Validate your `CONTEXT_LICENSE` object against the v1 JSON Schema:

```bash
npx @crawlertoll/publisher validate https://your-worker.workers.dev/.well-known/context-license.json
```

---

## RSL 1.0 directives this template uses

| Directive | Example | What |
|---|---|---|
| `User-agent: GPTBot` | matches GPTBot's UA string | Selects which agents the rules apply to |
| `Disallow: /` | block by default | Standard robots.txt |
| `Allow: /public` | open carve-out | Standard robots.txt (longest-match precedence) |
| `License: <url>` | human-readable terms | RSL extension |
| `Permits: ai-search, rag` | machine-readable permitted uses | RSL extension |
| `Prohibits: ai-training` | machine-readable prohibited uses | RSL extension |
| `Compensation: per-crawl 5000 micros USD` | tells crawlers what blocked paths cost | RSL extension — triggers a 402 when an agent hits a Disallowed path |
| `Standard: RSL/1.0` | declare which spec | RSL extension |

Full RSL 1.0 spec: <https://rslstandard.org/>

---

## Optional — pull policy from KV

For larger sites or multi-tenant setups, move the policy + license into a Cloudflare KV namespace and fetch them in the request handler. Uncomment the `CRAWLERTOLL_CONFIG` binding in `wrangler.toml`, create the namespace:

```bash
npx wrangler kv:namespace create CRAWLERTOLL_CONFIG
```

Add an env type:

```ts
type Env = {
  Variables: CrawlerTollVariables;
  Bindings: { CRAWLERTOLL_CONFIG: KVNamespace };
};
```

And read inside a handler:

```ts
app.get("/robots.txt", async (c) => {
  const txt = await c.env.CRAWLERTOLL_CONFIG.get("robots.txt");
  return new Response(txt ?? ROBOTS_TXT, { /* ... */ });
});
```

---

## What this template does NOT do

- **Settle payments.** This Worker emits a 402 with a payment offer. Actual settlement happens on whichever rail you chose — Coinbase x402, TollBit, Skyfire, Cloudflare PPC, or Stripe ACP. Adapter packages for each are in the `@crawlertoll/*` family (forthcoming for some).
- **Serve your real content.** This template ships a sample `/api/articles` endpoint that returns static JSON. Replace with a fetch to your real API, an R2 bucket, or whatever lives at your origin.
- **Replace Cloudflare Pay Per Crawl.** If you're on a Cloudflare Enterprise plan and have access to PPC's closed beta, you can use both — PPC at the CDN tier for crawl-budget enforcement, this Worker at the application tier for finer-grained policy (e.g. only charging on `/api/*` but not on the marketing pages).

---

## Compatible runtimes

`@crawlertoll/hono` (which this template uses) runs identically on:

- **Cloudflare Workers** ← you are here
- **Bun** (`Bun.serve({ fetch: app.fetch })`)
- **Deno** (`Deno.serve(app.fetch)`)
- **Vercel Edge** (`export const GET = handle(app)`)
- **Node 20+** (`@hono/node-server`)

The Worker code in `src/index.ts` is 99% portable. The `wrangler.toml` is the only CF-specific file.

---

## Resources

- **`@crawlertoll/core`** docs: <https://www.npmjs.com/package/@crawlertoll/core>
- **`@crawlertoll/hono`** docs: <https://www.npmjs.com/package/@crawlertoll/hono>
- **Hono on Workers** guide: <https://hono.dev/getting-started/cloudflare-workers>
- **RSL 1.0 spec**: <https://rslstandard.org/>
- **HTTP 402** Cloudflare pay-per-crawl: <https://blog.cloudflare.com/introducing-pay-per-crawl/>
- **Web Bot Auth** IETF draft: <https://datatracker.ietf.org/doc/draft-meunier-web-bot-auth-architecture/>
- **x402** Foundation: <https://x402.org>

---

## License

[Apache-2.0](./LICENSE). All specs implemented are open standards under their own licenses.
