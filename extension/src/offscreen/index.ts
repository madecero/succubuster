// Offscreen document: the on-device inference host. Loads CLIP via transformers.js
// (local models only, no network), precomputes the taxonomy text embeddings once,
// then scores each image by cosine similarity -> zero-shot category probabilities.
//
// If a trained head (succubuster_head.onnx) is bundled, it overrides the zero-shot
// suggestive score with the trained probability (same CLIP embedding as input).

import {
  env,
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';
import {
  ALL_PROMPT_STRINGS,
  zeroShotToVisionResult,
  type VisionResult,
} from '@succubuster/shared';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

// Local-only: never hit the network. Satisfies MV3 CSP + Web Store "no remote code".
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
// @ts-expect-error backends typing
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('ort/');
// @ts-expect-error single-thread avoids SharedArrayBuffer/COEP requirements
env.backends.onnx.wasm.numThreads = 1;

const useGpu = 'gpu' in navigator;
const device = useGpu ? 'webgpu' : 'wasm';
const dtype = 'q8' as const;

type Vec = Float32Array;

let ready = false;
let loadError: string | null = null;
let visionModel: any;
let processor: any;
let textEmbeds: Vec[] = []; // normalized, aligned to ALL_PROMPT_STRINGS
const cache = new Map<string, VisionResult>();

function l2norm(v: Float32Array): Vec {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Split a [n, d] tensor's flat data into n normalized row vectors. */
function rows(data: Float32Array, n: number, d: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) out.push(l2norm(data.subarray(i * d, (i + 1) * d) as Float32Array));
  return out;
}

async function load() {
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    processor = await AutoProcessor.from_pretrained(MODEL_ID);
    const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { device, dtype });
    visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { device, dtype });

    // Precompute + cache text embeddings for the whole taxonomy (labels are fixed).
    const inputs = tokenizer(ALL_PROMPT_STRINGS, { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs);
    const [n, d] = text_embeds.dims as [number, number];
    textEmbeds = rows(text_embeds.data as Float32Array, n, d);

    ready = true;
    console.log(`[succubuster] CLIP ready on ${device} (${ALL_PROMPT_STRINGS.length} prompts, dim ${d})`);
  } catch (e: any) {
    loadError = String(e?.message || e);
    console.error('[succubuster] model load failed:', loadError);
  }
}

const loading = load();

async function classifyOne(url: string): Promise<VisionResult> {
  const cached = cache.get(url);
  if (cached) return cached;
  if (!ready) {
    return { url, suggestive: 0, explicit: 0, category: 'benign', scores: {}, engine: 'unavailable' };
  }
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const image = await RawImage.fromBlob(blob);
    const inputs = await processor(image);
    const { image_embeds } = await visionModel(inputs);
    const [, d] = image_embeds.dims as [number, number];
    const img = l2norm((image_embeds.data as Float32Array).subarray(0, d) as Float32Array);
    const sims = textEmbeds.map((te) => dot(img, te));
    const result = zeroShotToVisionResult(url, sims);
    cache.set(url, result);
    if (cache.size > 1000) cache.delete(cache.keys().next().value as string);
    return result;
  } catch (e) {
    console.debug('[succubuster] classify error', url, e);
    return { url, suggestive: 0, explicit: 0, category: 'benign', scores: {}, engine: 'unavailable' };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'sb-classify') return false;
  (async () => {
    await loading;
    const urls: string[] = msg.urls || [];
    const results = await Promise.all(urls.map(classifyOne));
    sendResponse({ results, loadError });
  })();
  return true; // async
});
