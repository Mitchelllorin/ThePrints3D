# Ask AI proxy

A tiny server that holds **your** Gemini key so **users never need one**. The app
calls this; this calls Google. Free to run at small scale (stays under Gemini's
free tier); a per-device daily cap keeps a single user from burning it.

`src/worker.ts` targets **Cloudflare Workers** (free, no credit card, built-in KV
for the cap). It also runs on Vercel / Netlify / Deno with the KV bit swapped.

## Deploy on Cloudflare (recommended, ~15 min)

1. Make a free Cloudflare account (no card): https://dash.cloudflare.com/sign-up
2. Install the CLI: `npm i -g wrangler` then `wrangler login`
3. Create a KV namespace for the rate cap:
   ```
   wrangler kv namespace create ASK_KV
   ```
   Copy the returned `id` into `wrangler.toml` (see below).
4. Store your Gemini key as a secret (never in code):
   ```
   wrangler secret put GEMINI_API_KEY
   ```
   Paste your Google AI Studio key (aistudio.google.com — free, no card).
5. Deploy:
   ```
   wrangler deploy
   ```
   You'll get a URL like `https://ask-ai.<you>.workers.dev`.

## Point the app at it

In the app repo, set the proxy URL at build time (`.env` or CI env):

```
VITE_ASK_PROXY_URL=https://ask-ai.<you>.workers.dev
```

Rebuild. Now the app calls your proxy — **users need no key**, and Ask shows
"✦ AI on" for everyone. With no `VITE_ASK_PROXY_URL` set, the app falls back to
the own-key-on-device path (dev), then to the offline spec cards.

## wrangler.toml

```toml
name = "ask-ai"
main = "src/worker.ts"
compatibility_date = "2024-11-01"

[[kv_namespaces]]
binding = "ASK_KV"
id = "<paste the id from step 3>"

[vars]
FREE_PER_DAY = "10"   # free AI questions per device per day
```

## Other hosts

The Gemini call and prompt are host-agnostic. Only two things are Cloudflare-
specific: the `ASK_KV` rate-cap (swap for Vercel KV / Upstash / drop it) and the
`export default { fetch }` shape (Vercel/Netlify use their own handler signature).
