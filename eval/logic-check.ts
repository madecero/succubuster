// Tier-1 logic proof: the shared decision functions the extension ships.
// Bundled + run via esbuild so there's zero drift from the runtime code.
import {
  scoreText,
  combine,
  zeroShotToVisionResult,
  thresholdsFor,
  PROMPTS,
  type VisionResult,
} from '@succubuster/shared';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

console.log('\nText heuristics:');
const baitText = scoreText('check my OnlyFans link in bio 🔥💦', {});
check('explicit promo caption scores high', baitText.score >= 5, `(got ${baitText.score})`);
const benignText = scoreText('beautiful sunset over the mountains today', {});
check('benign caption scores 0', benignText.score === 0, `(got ${benignText.score})`);
const phraseText = scoreText('link in bio for my page', {});
check('two bait phrases reach threshold', phraseText.score >= 4, `(got ${phraseText.score})`);

console.log('\nCombine (text hard rule, no vision):');
check('hard text rule hides', combine(baitText, null, { sensitivity: 0.5, useVision: true }).hide);
check('benign text without vision is kept', !combine(benignText, null, { sensitivity: 0.5, useVision: true }).hide);

console.log('\nCombine (vision):');
const suggestive: VisionResult = { url: 'x', suggestive: 0.92, explicit: 0.05, category: 'thirst-trap', scores: {}, engine: 'clip-zeroshot' };
const benignVision: VisionResult = { url: 'y', suggestive: 0.12, explicit: 0.01, category: 'benign', scores: {}, engine: 'clip-zeroshot' };
check('high suggestive vision hides', combine(benignText, suggestive, { sensitivity: 0.5, useVision: true }).hide);
check('benign vision is kept', !combine(benignText, benignVision, { sensitivity: 0.5, useVision: true }).hide);
check('vision off => benign image not classified', !combine(benignText, suggestive, { sensitivity: 0.5, useVision: false }).hide);

console.log('\nSensitivity monotonicity:');
check('higher sensitivity lowers the bar', thresholdsFor(0.9).suggestive < thresholdsFor(0.1).suggestive);

console.log('\nZero-shot mapping:');
// Simulate sims that strongly favor the first prompt group (explicit).
const sims = PROMPTS.map((p, i) => (i === 0 ? 0.9 : 0.1));
const vr = zeroShotToVisionResult('z', sims);
check('argmax category surfaces', vr.category === PROMPTS[0].category, `(got ${vr.category})`);
check('suggestive = 1 - benign mass', vr.suggestive >= 0 && vr.suggestive <= 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
