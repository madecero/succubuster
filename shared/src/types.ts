// Shared contracts used across the content script, service worker, offscreen
// classifier, options page, and the eval harness. Keep this dependency-free.

export type Category =
  | 'explicit'
  | 'thirst-trap'
  | 'soft-core'
  | 'of-promo'
  | 'suggestive'
  | 'benign';

export const NON_BENIGN_CATEGORIES: Category[] = [
  'explicit',
  'thirst-trap',
  'soft-core',
  'of-promo',
  'suggestive',
];

/** A post extracted from the X timeline by the content script. */
export interface ExtractedPost {
  /** Stable per-post key for dedupe across re-scans (handle + caption hash). */
  postKey: string;
  handle: string;
  caption: string;
  mediaUrls: string[];
  /** X's own "sensitive content" warning was present on the post. */
  sensitiveFlag: boolean;
}

/** The text-only signal from the ported heuristics. Zero-cost, instant. */
export interface TextSignal {
  score: number;
  reasons: string[];
}

/** Per-image result from the on-device vision classifier (CLIP + head). */
export interface VisionResult {
  url: string;
  /** 0..1 probability the image is suggestive bait (any non-benign category). */
  suggestive: number;
  /** 0..1 probability the image is explicit. */
  explicit: number;
  category: Category;
  /** Raw per-category scores, for debugging/eval. */
  scores: Partial<Record<Category, number>>;
  /** Which engine produced this: zero-shot CLIP, or the trained head. */
  engine: 'clip-zeroshot' | 'trained-head' | 'unavailable';
}

/** The final decision for a post, combining text + vision. */
export interface Verdict {
  hide: boolean;
  /** 0..100 combined bait score, for display + tuning. */
  score: number;
  category: Category;
  reasons: string[];
}

export interface Settings {
  enabled: boolean;
  /** 0..1; higher = more aggressive (lower thresholds). */
  sensitivity: number;
  /** Blur (recoverable, click to reveal) or fully hide the cell. */
  mode: 'blur' | 'hide';
  /** Per-host enable toggle, keyed by hostname. */
  perSite: Record<string, boolean>;
  /** Handles the user manually restored; never re-hide these. */
  allowlist: string[];
  /** Master switch for the vision pass (text pre-filter always runs). */
  useVision: boolean;
  /** Has the user completed the first-run consent screen. */
  consented: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  sensitivity: 0.5,
  mode: 'blur',
  perSite: {},
  allowlist: [],
  useVision: true,
  consented: false,
};

// ---- message protocol (content <-> service worker <-> offscreen) ----

export interface ClassifyRequest {
  type: 'classify';
  urls: string[];
}
export interface ClassifyResponse {
  type: 'classifyResult';
  results: VisionResult[];
}
export interface FeedbackMessage {
  type: 'feedback';
  postKey: string;
  label: 'false-positive' | 'missed-bait';
  caption: string;
  mediaUrls: string[];
}
export interface StatsMessage {
  type: 'stats';
  hidden: number;
  scanned: number;
}

export type RuntimeMessage =
  | ClassifyRequest
  | ClassifyResponse
  | FeedbackMessage
  | StatsMessage
  | { type: 'getSettings' }
  | { type: 'settings'; settings: Settings };
