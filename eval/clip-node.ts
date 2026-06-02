// Node-side CLIP, mirroring the offscreen classifier but using the same bundled
// model and the SAME shared scoring (zeroShotToVisionResult), so eval numbers
// reflect exactly what the extension ships. Also exposes raw embeddings for
// training the ONNX head.
import {
  env,
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';
import { ALL_PROMPT_STRINGS, zeroShotToVisionResult, type VisionResult } from '@succubuster/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const here = path.dirname(fileURLToPath(import.meta.url));

// Reuse the exact model bundled into the extension (parity with runtime).
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = path.join(here, '..', 'extension', 'models') + path.sep;

type Vec = Float32Array;
let processor: any, visionModel: any;
let textEmbeds: Vec[] = [];

export function l2norm(v: Float32Array): Vec {
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

export async function loadClip(): Promise<void> {
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'q8' });
  visionModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'q8' });
  const inputs = tokenizer(ALL_PROMPT_STRINGS, { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs);
  const [n, d] = text_embeds.dims as [number, number];
  const data = text_embeds.data as Float32Array;
  textEmbeds = [];
  for (let i = 0; i < n; i++) textEmbeds.push(l2norm(data.subarray(i * d, (i + 1) * d) as Float32Array));
}

/** Normalized 512-d image embedding (for training the head). */
export async function embedUrl(url: string): Promise<Vec> {
  const image = await RawImage.fromURL(url);
  const inputs = await processor(image);
  const { image_embeds } = await visionModel(inputs);
  const [, d] = image_embeds.dims as [number, number];
  return l2norm((image_embeds.data as Float32Array).subarray(0, d) as Float32Array);
}

export function classifyVector(url: string, img: Vec): VisionResult {
  const sims = textEmbeds.map((te) => dot(img, te));
  return zeroShotToVisionResult(url, sims);
}

export async function classifyUrl(url: string): Promise<VisionResult> {
  return classifyVector(url, await embedUrl(url));
}
