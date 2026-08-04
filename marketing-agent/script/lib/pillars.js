'use strict';

/**
 * Pure, deterministic content-pillar rotation logic.
 *
 * Design note: the rotation is derived *statelessly* from the calendar
 * (how many Mon/Wed/Fri scheduled slots have elapsed since SCHEDULE_START_DATE)
 * rather than from a stored counter. This keeps the Cloud Function's Firestore
 * access strictly read-only (least privilege — it only needs to *read*
 * stats/global, never write its own state). Everything here is a pure function
 * so it is trivially unit-testable with no GCP dependencies.
 */

const SCHEDULE_WEEKDAYS = [1, 3, 5]; // Mon, Wed, Fri (0 = Sun ... 6 = Sat)

const PILLARS = Object.freeze({
  HOW_TO: 'how_to',
  LISTING_SPOTLIGHT: 'listing_spotlight',
  COMMUNITY: 'community',
  PET_CARE: 'pet_care',
  MILESTONE: 'milestone',
  LAUNCH_COUNTDOWN: 'launch_countdown',
});

// Cycle length 9 with the "community/awareness" pillar appearing 3x → the
// pillar that carries a generated illustration fires ~1 in 3 posts, per plan.
const ROTATION_DEFAULT = Object.freeze([
  PILLARS.LISTING_SPOTLIGHT,
  PILLARS.COMMUNITY,
  PILLARS.PET_CARE,
  PILLARS.MILESTONE,
  PILLARS.COMMUNITY,
  PILLARS.LISTING_SPOTLIGHT,
  PILLARS.PET_CARE,
  PILLARS.COMMUNITY,
  PILLARS.MILESTONE,
]);

// While the launch countdown is active it is woven into the same 9-slot cycle,
// still keeping community at 3/9 (~1 in 3 illustrated).
const ROTATION_WITH_COUNTDOWN = Object.freeze([
  PILLARS.LAUNCH_COUNTDOWN,
  PILLARS.COMMUNITY,
  PILLARS.LISTING_SPOTLIGHT,
  PILLARS.LAUNCH_COUNTDOWN,
  PILLARS.COMMUNITY,
  PILLARS.PET_CARE,
  PILLARS.MILESTONE,
  PILLARS.COMMUNITY,
  PILLARS.LISTING_SPOTLIGHT,
]);

/** Parse a YYYY-MM-DD string into a UTC-midnight Date. */
function parseDateUTC(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Truncate any Date to UTC midnight. */
function toUTCMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Count how many scheduled Mon/Wed/Fri days fall in [start, today] inclusive.
 * Returns 0 when today is before the start date.
 */
function slotsSince(startDate, today, weekdays = SCHEDULE_WEEKDAYS) {
  const start = toUTCMidnight(startDate);
  const end = toUTCMidnight(today);
  if (end < start) return 0;

  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (weekdays.includes(cursor.getUTCDay())) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Decide what today's post is.
 *
 * @param {Date}   today            The invocation date.
 * @param {string} scheduleStartISO YYYY-MM-DD of the first scheduled slot.
 * @param {boolean} countdownActive Whether the launch-countdown window is open.
 * @returns {{ pillar: string, isFirstPost: boolean, ordinal: number,
 *            rotationIndex: number|null, generateImage: boolean }}
 */
function resolvePost(today, scheduleStartISO, countdownActive) {
  const start = parseDateUTC(scheduleStartISO);
  const slots = slotsSince(start, today);

  // slots <= 1  → the very first scheduled slot (or a pre-launch manual test):
  // send the one-off "how to use NoHungryPets" intro post.
  if (slots <= 1) {
    return {
      pillar: PILLARS.HOW_TO,
      isFirstPost: true,
      ordinal: slots,
      rotationIndex: null,
      generateImage: false,
    };
  }

  const rotation = countdownActive ? ROTATION_WITH_COUNTDOWN : ROTATION_DEFAULT;
  // slots === 2 is the second scheduled run → first rotation entry (index 0).
  const rotationIndex = (slots - 2) % rotation.length;
  const pillar = rotation[rotationIndex];

  return {
    pillar,
    isFirstPost: false,
    ordinal: slots,
    rotationIndex,
    generateImage: pillar === PILLARS.COMMUNITY,
  };
}

/** Launch countdown is active while `now` is strictly before the cutoff. */
function isCountdownActive(now, launchCountdownUntilISO) {
  if (!launchCountdownUntilISO) return false;
  const until = parseDateUTC(launchCountdownUntilISO);
  return toUTCMidnight(now) < toUTCMidnight(until);
}

module.exports = {
  SCHEDULE_WEEKDAYS,
  PILLARS,
  ROTATION_DEFAULT,
  ROTATION_WITH_COUNTDOWN,
  slotsSince,
  resolvePost,
  isCountdownActive,
  parseDateUTC,
};
