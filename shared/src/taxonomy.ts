// The labeling taxonomy and the CLIP zero-shot prompt sets. This is the heart of
// the "suggestive bait, not just porn" wedge: commodity NSFW models only know
// explicit/nude. We define our own categories and describe them in natural
// language so CLIP can score an image against them with no training.
//
// Zero-shot scoring: embed the image, embed every prompt below, softmax the
// image<->prompt similarities across ALL prompts, then sum the probability mass
// landing on each category's prompts. suggestive = sum over non-benign groups;
// explicit = the explicit group's mass; category = argmax group.
//
// The benign group is intentionally large and specific. The #1 product risk is
// false positives (hiding swimwear ads, fitness, art, beach photos), so we give
// CLIP lots of benign anchors to pull those images toward "do not hide".

import type { Category } from './types.js';

export const PROMPT_GROUPS: Record<Category, string[]> = {
  explicit: [
    'an explicit pornographic image',
    'a photo showing nudity or exposed genitals',
    'a photograph of a sexual act',
  ],
  'thirst-trap': [
    'a suggestive thirst-trap selfie posted for attention',
    'a sexually suggestive selfie emphasizing the body',
  ],
  'soft-core': [
    'a soft-core erotic photo',
    'a woman in lingerie posing seductively',
    'a near-nude pin-up style photo',
  ],
  'of-promo': [
    'an OnlyFans promotional photo',
    'an adult content creator advertising their page',
  ],
  suggestive: [
    'a revealing outfit worn to look sexually suggestive',
    'a photo deliberately emphasizing cleavage or buttocks',
  ],
  benign: [
    'a normal everyday photo',
    'a family photo',
    'a landscape photograph',
    'a photo of food',
    'a person exercising at the gym in athletic wear',
    'a fashion editorial photograph',
    'a model walking on a fashion runway',
    'a product advertisement',
    'a swimwear product catalog photo',
    'a candid photo of people at the beach',
    'a person sunbathing on a beach',
    'tourists in swimwear on a summer vacation',
    'an outdoor summer or pool photo',
    'a car or vehicle',
    'a screenshot of text',
    'an internet meme with text',
    'a news photograph',
    'a pet or animal photo',
    'a selfie of a person in ordinary clothing',
    'a sports or athletics photo',
    'a piece of artwork or illustration',
  ],
};

/** Flat list of {category, prompt} in a stable order for embedding + indexing. */
export interface PromptEntry {
  category: Category;
  prompt: string;
}

export const PROMPTS: PromptEntry[] = (Object.keys(PROMPT_GROUPS) as Category[]).flatMap(
  (category) => PROMPT_GROUPS[category].map((prompt) => ({ category, prompt })),
);

export const ALL_PROMPT_STRINGS: string[] = PROMPTS.map((p) => p.prompt);
