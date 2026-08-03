'use strict';

/**
 * Prompt assembly for the marketing draft agent — pure functions, no I/O.
 *
 * Covers: the shared brand-voice brief, per-pillar text prompts, and the
 * rotating "sharing is caring" illustration prompt library. Kept dependency
 * free so it can be unit-tested in isolation.
 */

const { PILLARS } = require('./pillars');

const BRAND_VOICE = [
  'You write short social posts for NoHungryPets, a free UK community website',
  'where neighbours share surplus pet food and supplies — give what you can,',
  'take what you need. Voice: warm, friendly, local, practical, and',
  'anti-food-waste; pet-loving without being twee. British English spelling.',
].join(' ');

const OUTPUT_RULES = [
  'Write ONLY the finished Facebook post copy — no preamble, no explanation,',
  'no markdown, no surrounding quotes, no "Option 1/2" alternatives.',
  'Around 45–110 words. Use 1–4 tasteful emoji. Include a short call to action',
  'and end with 3–5 relevant hashtags (always include #NoHungryPets).',
].join(' ');

/**
 * Build the text prompt for a given pillar.
 *
 * @param {string} pillar  One of PILLARS.*
 * @param {object} ctx     { siteUrl, facebookUrl, stats, launchCountdownUntil, now }
 * @returns {string}
 */
function buildTextPrompt(pillar, ctx = {}) {
  const { siteUrl = 'https://nohungrypets.co.uk', stats = null } = ctx;
  const link = `Include the link ${siteUrl} in the post.`;

  const brief = (task) =>
    `${BRAND_VOICE}\n\n${task}\n\n${link}\n\n${OUTPUT_RULES}`;

  switch (pillar) {
    case PILLARS.HOW_TO:
      return brief(
        [
          'Write the very first launch post: a friendly "how NoHungryPets works"',
          'intro. It MUST contain 3–4 numbered steps that walk a newcomer through:',
          '(1) sign up for a free account, (2) post the pet food or supplies you',
          'no longer need, (3) search nearby to find what you do need, and',
          'optionally (4) arrange a friendly local handover. Keep the steps as',
          'short numbered lines. Open with a warm one-line welcome and close with',
          'an encouraging call to action to join.',
        ].join(' ')
      );

    case PILLARS.LISTING_SPOTLIGHT:
      return brief(
        [
          'Write a "listing spotlight" style post that encourages people to browse',
          'current listings and to pass on surplus pet food/supplies rather than',
          'bin them. Do NOT invent specific fake items, prices or names — keep it',
          'general and inviting so it works alongside a REAL photo of a real',
          'listing that will be attached separately. Gently nudge readers to have',
          'a look at what neighbours are sharing right now.',
        ].join(' ')
      );

    case PILLARS.COMMUNITY:
      return brief(
        [
          'Write a warm "community / awareness" post on the theme of sharing is',
          'caring: how a small act — passing on half a bag of food or an unused bed',
          '— helps a neighbour and keeps a pet fed. Make it emotional and uplifting',
          'and encourage people to be part of a kinder, less wasteful local',
          'community. This post will be paired with a soft illustrated image.',
        ].join(' ')
      );

    case PILLARS.PET_CARE:
      return brief(
        [
          'Write a genuinely useful, bite-sized pet-care tip (dogs or cats) — e.g.',
          'safe storage of opened food, portioning, hydration in warm weather, or',
          'introducing a new food gradually. One clear practical tip, not a list.',
          'Then tie it back to reducing waste and sharing surplus on NoHungryPets.',
        ].join(' ')
      );

    case PILLARS.MILESTONE: {
      const statsLine = stats
        ? [
            'Use these real live community numbers (do not exaggerate or change',
            `them): ${stats.totalUsers ?? 0} members have joined,`,
            `${stats.totalListings ?? 0} listings shared, and`,
            `${stats.totalClaims ?? 0} items rehomed to a new pet.`,
            'If a number is 0, phrase it as "just getting started" rather than',
            'quoting the zero.',
          ].join(' ')
        : [
            'Community stats were unavailable, so write a general "we are growing,',
            'thank you" milestone post WITHOUT quoting any specific numbers.',
          ].join(' ');
      return brief(
        [
          'Write a celebratory "milestone / thank you" post highlighting the',
          'community\'s impact so far.',
          statsLine,
          'Thank members and invite others to join in.',
        ].join(' ')
      );
    }

    case PILLARS.LAUNCH_COUNTDOWN:
      return brief(
        [
          'Write an upbeat launch-hype post. NoHungryPets has just launched (or is',
          'brand new). Build friendly excitement, explain in one line what it is',
          '(free, local sharing of pet food and supplies), and urge people to be',
          'among the first to sign up and share the word with pet-owning friends.',
        ].join(' ')
      );

    default:
      throw new Error(`Unknown pillar: ${pillar}`);
  }
}

/**
 * Style-locked prefix applied to every illustration prompt: warm, soft-coloured,
 * "sharing is caring" dog-and-cat theme, and explicitly NO text in the image.
 */
const ILLUSTRATION_STYLE =
  'A warm, soft-coloured, gentle flat illustration in a cosy hand-drawn style, ' +
  'muted pastel palette (soft peach, cream, sage, warm terracotta), soft ' +
  'lighting, friendly and heart-warming mood. Cute but not childish. ' +
  'IMPORTANT: absolutely no text, no words, no letters, no logos and no ' +
  'watermark anywhere in the image.';

/** Rotating library of "sharing is caring" dog-and-cat scenes (no text). */
const ILLUSTRATION_SCENES = Object.freeze([
  'A friendly neighbour handing a small bag of pet food to another person over ' +
    'a garden fence, a happy dog and a cat watching nearby.',
  'A contented dog and a cat sharing a bowl of food together on a cosy kitchen ' +
    'floor, sunlight coming through a window.',
  'Two neighbours meeting on a doorstep to pass along a basket of pet supplies, ' +
    'a wagging dog beside them.',
  'A pair of cupped human hands gently offering kibble, with a small dog and a ' +
    'curious cat looking up hopefully.',
  'A cosy community scene: several people and their pets — dogs and cats — ' +
    'gathered around a table sharing pet food and blankets.',
  'A cat and a dog curled up together on a soft blanket beside a full food bowl, ' +
    'a warm and safe home feeling.',
]);

/**
 * Pick an illustration prompt for the given rotation ordinal.
 * @param {number} ordinal  Any non-negative integer (post ordinal).
 * @returns {string}
 */
function buildImagePrompt(ordinal = 0) {
  const scene = ILLUSTRATION_SCENES[Math.abs(ordinal) % ILLUSTRATION_SCENES.length];
  return `${ILLUSTRATION_STYLE} Scene: ${scene}`;
}

module.exports = {
  BRAND_VOICE,
  OUTPUT_RULES,
  ILLUSTRATION_STYLE,
  ILLUSTRATION_SCENES,
  buildTextPrompt,
  buildImagePrompt,
};
