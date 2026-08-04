'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  PILLARS,
  ROTATION_DEFAULT,
  ROTATION_WITH_COUNTDOWN,
  slotsSince,
  resolvePost,
  isCountdownActive,
  parseDateUTC,
} = require('../lib/pillars');

// 2026-08-03 is a Monday. Mon/Wed/Fri slots that week: Aug 3, 5, 7.
const START = '2026-08-03';
const d = (iso) => parseDateUTC(iso);

test('slotsSince counts Mon/Wed/Fri inclusively', () => {
  assert.equal(slotsSince(d(START), d('2026-08-03')), 1); // Mon
  assert.equal(slotsSince(d(START), d('2026-08-04')), 1); // Tue (no new slot)
  assert.equal(slotsSince(d(START), d('2026-08-05')), 2); // Wed
  assert.equal(slotsSince(d(START), d('2026-08-07')), 3); // Fri
  assert.equal(slotsSince(d(START), d('2026-08-10')), 4); // next Mon
});

test('slotsSince is 0 before the start date', () => {
  assert.equal(slotsSince(d(START), d('2026-08-01')), 0);
});

test('first scheduled slot is the one-off how-to post', () => {
  const p = resolvePost(d('2026-08-03'), START, false);
  assert.equal(p.pillar, PILLARS.HOW_TO);
  assert.equal(p.isFirstPost, true);
  assert.equal(p.generateImage, false);
});

test('a pre-launch manual test still yields the how-to post', () => {
  const p = resolvePost(d('2026-08-01'), START, false);
  assert.equal(p.pillar, PILLARS.HOW_TO);
  assert.equal(p.isFirstPost, true);
});

test('second slot starts the rotation at index 0', () => {
  const p = resolvePost(d('2026-08-05'), START, false);
  assert.equal(p.isFirstPost, false);
  assert.equal(p.rotationIndex, 0);
  assert.equal(p.pillar, ROTATION_DEFAULT[0]);
});

test('rotation walks forward with each scheduled slot', () => {
  assert.equal(resolvePost(d('2026-08-05'), START, false).rotationIndex, 0); // Wed
  assert.equal(resolvePost(d('2026-08-07'), START, false).rotationIndex, 1); // Fri
  assert.equal(resolvePost(d('2026-08-10'), START, false).rotationIndex, 2); // Mon
});

test('community pillar fires ~1 in 3 and carries an image', () => {
  const communityCount = ROTATION_DEFAULT.filter((p) => p === PILLARS.COMMUNITY).length;
  assert.equal(communityCount, 3);
  assert.equal(ROTATION_DEFAULT.length, 9);
  // Every community slot triggers image generation, and only those.
  ROTATION_DEFAULT.forEach((pillar, i) => {
    // slot ordinal for rotationIndex i is i+2
    const p = resolvePost(scheduledDate(i + 2), START, false);
    assert.equal(p.pillar, pillar);
    assert.equal(p.generateImage, pillar === PILLARS.COMMUNITY);
  });
});

test('countdown rotation is used only while active, community still 3/9', () => {
  assert.equal(
    ROTATION_WITH_COUNTDOWN.filter((p) => p === PILLARS.COMMUNITY).length,
    3
  );
  assert.ok(ROTATION_WITH_COUNTDOWN.includes(PILLARS.LAUNCH_COUNTDOWN));
  const active = resolvePost(d('2026-08-05'), START, true);
  assert.equal(active.pillar, ROTATION_WITH_COUNTDOWN[0]);
  const inactive = resolvePost(d('2026-08-05'), START, false);
  assert.equal(inactive.pillar, ROTATION_DEFAULT[0]);
});

test('isCountdownActive respects the cutoff date', () => {
  assert.equal(isCountdownActive(d('2026-08-05'), '2026-08-17'), true);
  assert.equal(isCountdownActive(d('2026-08-17'), '2026-08-17'), false);
  assert.equal(isCountdownActive(d('2026-08-20'), '2026-08-17'), false);
  assert.equal(isCountdownActive(d('2026-08-05'), ''), false);
});

// Helper: the Nth scheduled Mon/Wed/Fri date (1-based) from START.
function scheduledDate(n) {
  const cursor = parseDateUTC(START);
  let count = 0;
  // Ensure we count the start day itself.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const day = cursor.getUTCDay();
    if ([1, 3, 5].includes(day)) {
      count += 1;
      if (count === n) return new Date(cursor);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}
