// Pure scoring logic, shared by the offscreen classifier (runtime) and the eval
// harness (offline). No DOM, no chrome APIs — so the eval can import it directly
// and prove the exact same decision function the extension ships.

import type { Category, TextSignal, VisionResult, Verdict, Settings } from './types.js';
import { PROMPTS } from './taxonomy.js';
import { TEXT_HARD_THRESHOLD } from './text-heuristics.js';

/** Softmax with a temperature; CLIP logit scale ~100, but we feed cosine sims. */
export function softmax(xs: number[], temperature = 100): number[] {
  const scaled = xs.map((x) => x * temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/**
 * Turn raw image<->prompt cosine similarities (aligned to PROMPTS order) into a
 * VisionResult by softmaxing across all prompts and summing probability mass per
 * category.
 */
export function zeroShotToVisionResult(url: string, sims: number[]): VisionResult {
  const probs = softmax(sims);
  const byCat = new Map<Category, number>();
  PROMPTS.forEach((entry, i) => {
    byCat.set(entry.category, (byCat.get(entry.category) ?? 0) + probs[i]);
  });

  const scores: Partial<Record<Category, number>> = {};
  let topCat: Category = 'benign';
  let topVal = -Infinity;
  for (const [cat, val] of byCat) {
    scores[cat] = val;
    if (val > topVal) {
      topVal = val;
      topCat = cat;
    }
  }

  const benign = byCat.get('benign') ?? 0;
  const explicit = byCat.get('explicit') ?? 0;
  const suggestive = Math.min(1, Math.max(0, 1 - benign)); // mass on all non-benign groups

  return { url, suggestive, explicit, category: topCat, scores, engine: 'clip-zeroshot' };
}

export interface CombineThresholds {
  /** suggestive prob at/above which we hide. Derived from sensitivity. */
  suggestive: number;
  /** explicit prob at/above which we hide (kept lower — explicit is worse). */
  explicit: number;
  /** mid text score (>= this) lowers the suggestive threshold (corroboration). */
  textCorroborate: number;
  textCorroborateBonus: number;
}

export function thresholdsFor(sensitivity: number): CombineThresholds {
  const s = Math.min(1, Math.max(0, sensitivity));
  const lerp = (lo: number, hi: number) => lo + (hi - lo) * s;
  return {
    // higher sensitivity -> lower threshold -> more aggressive
    suggestive: lerp(0.85, 0.45),
    explicit: lerp(0.6, 0.3),
    textCorroborate: 2,
    textCorroborateBonus: 0.12,
  };
}

/**
 * Combine the free text signal with the (optional) vision result into a final
 * verdict. Text hard rule fires first (zero cost). Otherwise the vision pass
 * decides, with a mid text score lowering the bar (corroboration).
 */
export function combine(
  text: TextSignal,
  vision: VisionResult | null,
  settings: Pick<Settings, 'sensitivity' | 'useVision'>,
): Verdict {
  const reasons: string[] = [];
  const t = thresholdsFor(settings.sensitivity);

  // 1. Text hard rule — an explicit/strong term or adult marker is decisive.
  if (text.score >= TEXT_HARD_THRESHOLD) {
    return {
      hide: true,
      score: Math.min(100, 60 + text.score * 4),
      category: 'of-promo',
      reasons: ['text: ' + text.reasons.join('; ')],
    };
  }

  if (text.reasons.length) reasons.push('text: ' + text.reasons.join('; '));

  // 2. Vision pass.
  if (settings.useVision && vision && vision.engine !== 'unavailable') {
    let suggestiveBar = t.suggestive;
    if (text.score >= t.textCorroborate) {
      suggestiveBar -= t.textCorroborateBonus;
      reasons.push(`text corroboration (-${t.textCorroborateBonus} bar)`);
    }

    const hideExplicit = vision.explicit >= t.explicit;
    const hideSuggestive = vision.suggestive >= suggestiveBar;
    reasons.push(
      `vision: ${vision.category} suggestive=${vision.suggestive.toFixed(2)} explicit=${vision.explicit.toFixed(2)} (bar ${suggestiveBar.toFixed(2)})`,
    );

    if (hideExplicit || hideSuggestive) {
      return {
        hide: true,
        score: Math.round(Math.max(vision.suggestive, vision.explicit) * 100),
        category: vision.category,
        reasons,
      };
    }
    return { hide: false, score: Math.round(vision.suggestive * 100), category: vision.category, reasons };
  }

  // 3. No vision available — fall back to a softer text-only rule.
  const hide = text.score >= 4;
  return {
    hide,
    score: Math.min(100, text.score * 12),
    category: hide ? 'suggestive' : 'benign',
    reasons,
  };
}
