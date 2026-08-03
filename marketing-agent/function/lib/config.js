'use strict';

/**
 * Centralised environment/config parsing for the marketing draft agent.
 *
 * Secrets (GEMINI_API_KEY, GMAIL_APP_PASSWORD) are injected as environment
 * variables at deploy time from Secret Manager (see ../terraform). They are
 * never hardcoded or committed anywhere.
 */

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * Build the runtime config. Called once per invocation.
 * `now` is injectable purely to keep it testable.
 */
function loadConfig(now = new Date()) {
  return {
    // --- Secrets (from Secret Manager via env) ---
    geminiApiKey: required('GEMINI_API_KEY'),
    gmailAppPassword: required('GMAIL_APP_PASSWORD'),

    // --- Email ---
    gmailSender: optional('GMAIL_SENDER', 'agipasieka79@gmail.com'),
    recipientEmail: optional('RECIPIENT_EMAIL', 'agipasieka79@gmail.com'),

    // --- Models (overridable for future-proofing) ---
    textModel: optional('GEMINI_TEXT_MODEL', 'gemini-2.5-flash'),
    imageModel: optional('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'),

    // --- Scheduling / rotation ---
    // First scheduled Mon/Wed/Fri slot. The very first slot on/after this
    // date sends the one-off "how to use NoHungryPets" post; every slot
    // after that walks the content-pillar rotation. Stateless & deterministic
    // so the function needs no Firestore *write* access (least privilege).
    scheduleStartDate: optional('SCHEDULE_START_DATE', '2026-08-04'),

    // Launch-countdown pillar is only mixed into the rotation while "now" is
    // before this date. Set it a couple of weeks out at launch, then it
    // silently drops itself from the rotation. Leave unset/past to disable.
    launchCountdownUntil: optional('LAUNCH_COUNTDOWN_UNTIL', ''),

    // --- Site / brand ---
    siteUrl: optional('SITE_URL', 'https://nohungrypets.co.uk'),
    facebookUrl: optional('FACEBOOK_URL', 'https://www.facebook.com/nohungrypets'),

    // --- Firestore ---
    firestoreDatabaseId: optional('FIRESTORE_DATABASE_ID', '(default)'),
    statsDocPath: optional('STATS_DOC_PATH', 'stats/global'),

    now,
  };
}

module.exports = { loadConfig };
