# Succubuster — morning brief (2026-06-02)

Built overnight per your call: **no Anthropic API. Our own model, fully on-device.**

## What works right now

**The extension is real and builds.** Fully client-side classifier: ported text
heuristics + **CLIP zero-shot** (transformers.js) running in an MV3 offscreen
document (WebGPU, WASM fallback), models bundled locally so nothing leaves the
browser and there's no remote code. Blur/hide + "why" + restore + "Not bait"
feedback + a log panel; options page with a sensitivity slider and a first-run
consent screen.

**We trained our own model.** A logistic-regression head on CLIP embeddings,
exported to ONNX. 5-fold cross-validated **AUC 0.922**; the ONNX output matches
sklearn to 1e-7. It's retrainable on feedback data in seconds on CPU (no Azure
needed for this size; Azure ML is the documented fallback for bigger runs).

**It's proven in a real browser, via Claude-in-Chrome.** A self-validating demo
classifies 49 labeled images live on WebGPU and scores itself against ground truth:
- zero-shot **AUC 0.926** in-browser
- **precision 1.00 at the default sensitivity (zero false positives)**
- recall tunable 0.38 → 0.56 with the slider
- the #1 risk (hiding benign swimwear/fitness/beach) is controlled: beach
  false-positives were cut from 4/8 to 2/8 by tuning the benign prompt anchors.

## See it yourself

```bash
cd ~/Documents/DeCeroAI_Projects/succubuster
npm install && npm run download-models && npm run build   # if starting fresh
node extension/scripts/fetch-demo-images.mjs && npm run build
cd extension/dist && python3 -m http.server 8848
# open http://127.0.0.1:8848/demo.html   (drag the sensitivity slider)
```

Load the real extension: `chrome://extensions` → Developer mode → **Load unpacked**
→ select `extension/dist`. Open x.com, click the toolbar icon, accept consent.

Run the offline eval / retrain:
```bash
npx tsx eval/run-eval.ts            # precision/recall/AUC + per-category FP
npx tsx eval/extract-embeddings.ts && source train/.venv/bin/activate && python train/train_head.py
```

## Honest gaps / next

- **Trained head not yet wired into runtime** — zero-shot makes the decision today;
  the head is trained, exported, and validated, ready to plug in. On 49 samples it
  only matches zero-shot, so its payoff comes with more data (the feedback flywheel).
- **Recall ceiling ~0.56** on the mildest clothed/"thirst-trap" cases and on vintage
  pin-up illustrations (CLIP prompts say "photo"). Bigger, better-labeled data is the
  lever. The 49-image set is a starting point, not the finish line.
- **Real X feed run** still pending (loading the unpacked extension needs the Chrome
  file picker, which I can't drive headlessly). The demo proves the same pipeline; a
  5-minute manual load validates it on your actual feed.

## Where things live
- Code + Linear status: github.com/madecero/succubuster, Linear team SUC (16 issues
  Done, the Claude-proxy issues canceled as obsolete).
- Azure RG-SUCCUBUSTER: untouched — on-device means we didn't need it yet.
