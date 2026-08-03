'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { PILLARS } = require('../lib/pillars');
const {
  buildTextPrompt,
  buildImagePrompt,
  ILLUSTRATION_SCENES,
} = require('../lib/prompts');

test('every pillar produces a non-empty text prompt with the site link', () => {
  for (const pillar of Object.values(PILLARS)) {
    const prompt = buildTextPrompt(pillar, { siteUrl: 'https://nohungrypets.co.uk' });
    assert.ok(prompt.length > 50, `prompt too short for ${pillar}`);
    assert.ok(prompt.includes('https://nohungrypets.co.uk'));
    assert.ok(/NoHungryPets/.test(prompt));
  }
});

test('how-to prompt asks for numbered steps', () => {
  const prompt = buildTextPrompt(PILLARS.HOW_TO, {});
  assert.match(prompt, /numbered steps/i);
  assert.match(prompt, /sign up/i);
});

test('listing-spotlight prompt avoids inventing items and expects a real photo', () => {
  const prompt = buildTextPrompt(PILLARS.LISTING_SPOTLIGHT, {});
  assert.match(prompt, /real photo/i);
  assert.match(prompt, /do not invent/i);
});

test('milestone prompt embeds live numbers when stats are present', () => {
  const prompt = buildTextPrompt(PILLARS.MILESTONE, {
    stats: { totalUsers: 42, totalListings: 17, totalClaims: 9 },
  });
  assert.match(prompt, /42/);
  assert.match(prompt, /17/);
  assert.match(prompt, /9/);
});

test('milestone prompt degrades gracefully with no stats', () => {
  const prompt = buildTextPrompt(PILLARS.MILESTONE, { stats: null });
  assert.match(prompt, /WITHOUT quoting any specific numbers/i);
});

test('unknown pillar throws', () => {
  assert.throws(() => buildTextPrompt('nope', {}));
});

test('image prompt is style-locked, no-text, and rotates through the library', () => {
  const p0 = buildImagePrompt(0);
  assert.match(p0, /no text/i);
  assert.match(p0, /soft/i);
  // rotation wraps around the library
  assert.equal(buildImagePrompt(0), buildImagePrompt(ILLUSTRATION_SCENES.length));
  assert.notEqual(buildImagePrompt(0), buildImagePrompt(1));
});
