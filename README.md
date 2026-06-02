# Succubuster

A Chrome extension that removes **suggestive engagement-bait** (thirst-traps, soft-core,
OnlyFans-promo) from your X/Twitter feed. The wedge: the clothed-but-suggestive content that
commodity NSFW models score "safe."

**Everything runs on your device.** No images or data leave the browser. There is no server
and no third-party inference API.

## How it works

```
content script            service worker            offscreen document
(x.com timeline)   ──▶     (router + lifecycle)  ──▶ (CLIP, WebGPU/WASM)
  scan posts                ensure offscreen          fetch + decode image
  extract media+caption     relay urls                CLIP image embedding
  free text pre-filter  ◀── relay scores          ◀── cosine vs taxonomy prompts
  blur / hide / restore                               zero-shot category scores
```

1. **Text pre-filter** (ported from the original userscript) catches obvious promo/explicit
   captions for free — no model call.
2. **CLIP zero-shot** (`Xenova/clip-vit-base-patch32`, quantized, bundled locally) scores each
   image against a custom taxonomy of suggestive vs. benign prompts. This is what catches
   image-only bait that text rules and commodity NSFW models miss.
3. An optional **trained head** (`succubuster_head.onnx`, a logistic-regression probe on CLIP
   embeddings) sharpens the decision once we have labeled data. See `eval/`.
4. The combined verdict blurs or hides the post, with a "why", one-click restore, and a
   "Not bait" feedback button.

## Layout

- `shared/` — taxonomy, text heuristics, and the pure scoring/decision functions (shipped by
  the extension **and** imported by the eval harness, so there's no drift).
- `extension/` — the MV3 extension (esbuild). `npm run build` -> `extension/dist/`.
- `eval/` — offline accuracy harness: precision/recall, threshold sweep, text-only-vs-vision
  lift, and the CPU training pipeline for the ONNX head.

## Build & load

```bash
npm install
npm run download-models     # one-time: pulls the CLIP model into extension/models/ (~154 MB)
npm run build               # -> extension/dist/
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `extension/dist`. Open any `x.com` tab; click the toolbar icon for settings and accept
the one-time consent screen.

## Privacy / Trust & Safety

- Inference is 100% local; the model and runtime are bundled, `allowRemoteModels=false`.
- No image is ever uploaded or persisted. Feedback is stored locally only.
- See Linear project 4 (Trust, Safety & Legal) for the CSAM/ToS posture.
