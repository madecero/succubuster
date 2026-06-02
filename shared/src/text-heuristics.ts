// Cheap, instant, zero-cost text pre-filter. Ported faithfully from Michael's
// "X Feed Filter — bait remover" userscript (v1.1). Catches obvious promo/explicit
// bait by caption alone so we never spend a vision pass on it. The vision model
// exists to catch what THIS misses: image-only / clothed-but-suggestive bait.

import type { TextSignal } from './types.js';

// Instant-remove terms: adult platforms + explicit promo. Score 5 each.
export const STRONG_TERMS = [
  'onlyfans', 'only fans', 'onlyfan', 'fansly', '0nlyfans', '0nlyf',
  'myfans', 'fanvue', 'manyvids', 'chaturbate', 'camsoda', 'stripchat',
  'cashapp for nudes', 'sell content', 'spicy content', 'spicy page',
  'spicy acc', 'spicy account', 'my spicy', 'nudes', 'sextape', 'sex tape',
];

// Explicit words. Score 5 each.
export const EXPLICIT_TERMS = [
  'horny', 'creampie', 'blowjob', 'cumshot', 'deepthroat', 'masturbat',
  'pornhub', 'porn', 'xxx', 'milf', 'bbw', 'anal', 'fuck me',
];

// Adult markers. Score 4 each.
export const MARKER_TERMS = ['🔞', '18+', 'nsfw', 'not safe for work', 'adults only'];

// Bait phrases — promo/come-on language. Score 2 each. Two together = removed.
export const BAIT_PHRASES = [
  'link in bio', 'linkinbio', 'link in my bio', 'check my bio', 'check bio',
  'dm for', 'dm me', 'dms open', 'check my page', 'my page', 'subscribe to me',
  'subscribe to my', 'sub to my', 'tap the link', 'click my link',
  'check my profile', 'come see', 'come play', "let's chat", 'lets chat',
  'private content', 'exclusive content', 'free trial',
];

// Suggestive emoji. Score 1 each, capped, so emoji alone basically never removes.
export const SUGGESTIVE_EMOJI = ['🍑', '🍆', '💦', '👅', '😈', '🥵', '💋', '🔥', '👙', '🥴', '🤤'];
export const EMOJI_SCORE_CAP = 3;

// X's own "sensitive content" warning. Deliberately not enough alone.
export const SENSITIVE_FLAG_SCORE = 2;

/** Score reached by a single strong/explicit term — enough to hide on text alone. */
export const TEXT_HARD_THRESHOLD = 5;

const ZERO_WIDTH = /[​‌‍﻿]/g;

export function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(ZERO_WIDTH, '')
    .replace(/[._\-]+/g, ' '); // de-obfuscate only.f_a-n_s
}

export function scoreText(rawText: string, opts?: { sensitiveFlag?: boolean }): TextSignal {
  const reasons: string[] = [];
  let total = 0;
  const text = normalize(rawText);

  const hit = (list: string[], pts: number, label: string) => {
    for (const term of list) {
      if (text.includes(normalize(term))) {
        total += pts;
        reasons.push(`${label}: "${term}" (+${pts})`);
      }
    }
  };

  hit(STRONG_TERMS, 5, 'platform/promo');
  hit(EXPLICIT_TERMS, 5, 'explicit');
  hit(MARKER_TERMS, 4, 'adult marker');
  hit(BAIT_PHRASES, 2, 'bait phrase');

  // Emoji counted on the raw string (normalization would strip nothing here, but
  // we want the literal glyphs), capped so emoji never carries a decision alone.
  let emojiPts = 0;
  for (const e of SUGGESTIVE_EMOJI) {
    if (rawText.includes(e)) {
      emojiPts += 1;
      reasons.push(`emoji: ${e} (+1)`);
    }
  }
  total += Math.min(emojiPts, EMOJI_SCORE_CAP);

  if (opts?.sensitiveFlag && SENSITIVE_FLAG_SCORE > 0) {
    total += SENSITIVE_FLAG_SCORE;
    reasons.push(`X sensitive flag (+${SENSITIVE_FLAG_SCORE})`);
  }

  return { score: total, reasons };
}
