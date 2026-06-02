# Succubuster — Build & Prove Plan

Goal (Michael, 2026-06-01): build it out and test with Claude-in-Chrome until it's
proven to do its job and is scalable. Repo: github.com/madecero/succubuster.
Infra: Azure RG-SUCCUBUSTER (eastus2). Linear: team SUC, projects 1-6.

This session targets **Project 1 (MVP)** end-to-end + enough of **Project 2 (eval)**
to prove accuracy and the gap vs the text-only userscript. Projects 3-6 stay in Linear backlog.

## Architecture decisions
- **Monorepo, npm workspaces:** `extension/`, `backend/`, `eval/`, `shared/`.
- **Extension build = esbuild** (not Vite/@crxjs) — fewest moving parts, robust on Node 26, trivial to scale.
- **Backend = Azure Function (TS, v4 model), HTTP `POST /classify`** in RG-SUCCUBUSTER.
  Holds the Claude key server-side (never in the extension). Key in Azure Key Vault.
- **Vision model:** start Sonnet (cost/quality); test Haiku for cost per Project 2.
- **Contract (`shared/`):** `{images:[{url,hash}], caption} -> {results:[{hash,score 0-3,category,reason}]}`.

## Definition of done (the "proof")
1. Extension loads in Chrome, runs on x.com, finds posts, extracts media+caption.
2. Cheap text pre-filter (ported userscript) catches obvious bait with zero API cost.
3. Image-bearing posts that text misses get a Claude-vision score; suggestive bait is hidden/blurred.
4. "Why hidden" + restore + feedback all work; log panel shows decisions.
5. Eval harness reports precision/recall on a labeled set, and quantifies vision's lift over text-only.
6. Driven live on a real X feed via Claude-in-Chrome; iterated until precision/recall clears a bar.
7. Cost controls proven: hash cache hits, batching, hard cost ceiling + kill switch.

## Tasks
### Foundation
- [ ] Root scaffold: package.json workspaces, tsconfig, .gitignore, README
- [ ] `shared/`: types + classification contract + scoring constants

### Extension (SUC-1..16)
- [ ] esbuild build pipeline (content IIFE, background module, options page) + zip artifact
- [ ] manifest.json (MV3, minimal host perms: x.com/twitter.com + backend origin)
- [ ] content script: post detection + media/caption extraction (SPA virtualization safe)
- [ ] port text heuristics from userscript as cheap pre-filter
- [ ] background worker: queue -> backend client, image hashing, in-mem cache, threshold engine
- [ ] hide/blur + "why hidden" + restore + feedback buttons + log panel
- [ ] options page: sensitivity slider, per-site toggle, allowlist, counters
- [ ] first-run consent screen

### Backend (SUC-8..11)
- [ ] Azure Function `classify`: Claude vision call, 0-3 score + category + reason
- [ ] image-hash cache, batching, rate limit, hard cost ceiling + kill switch
- [ ] auth between extension and proxy (shared secret / token)
- [ ] deploy to RG-SUCCUBUSTER; key in Key Vault

### Eval / proof (SUC-17..19, 23)
- [ ] labeling schema + small curated eval set
- [ ] harness: precision/recall/F1; text-only vs text+vision benchmark
- [ ] false-positive audit set (swimwear, fitness, art, medical, beach)
- [ ] live test on real X feed via Claude-in-Chrome; tune threshold; record go/no-go

## Blockers
- **Anthropic API key** — required for the classifier. Nothing end-to-end works without it.

## Review
(to be filled in as work completes)
