'use strict';

/**
 * NoHungryPets — Free Marketing Draft Agent (plain Node script).
 *
 * Run on a schedule by a GitHub Actions workflow (Mon/Wed/Fri, see
 * ../../.github/workflows/marketing-agent.yml) — or manually via
 * `node marketing-agent/script/run.js`. Each run: pick the day's content
 * pillar, write the Facebook post copy with Gemini, generate an illustration
 * for ~1-in-3 (community) posts, read live community stats for milestone posts,
 * then email the finished draft to the site owner. Nothing is auto-posted — a
 * human reviews and posts manually.
 *
 * This deliberately uses NO GCP compute (no Cloud Function / Scheduler /
 * Pub/Sub / Secret Manager) so the project stays on the free Firebase Spark
 * plan with no billing account attached. Secrets come from GitHub Actions repo
 * secrets, injected as env vars.
 */

const { loadConfig } = require('./lib/config');
const { resolvePost, isCountdownActive, PILLARS } = require('./lib/pillars');
const { buildTextPrompt, buildImagePrompt } = require('./lib/prompts');
const gemini = require('./lib/gemini');
const { readStats } = require('./lib/firestore');
const { sendDraft } = require('./lib/mailer');

async function run(now = new Date()) {
  const cfg = loadConfig(now);

  const countdownActive = isCountdownActive(cfg.now, cfg.launchCountdownUntil);
  const plan = resolvePost(cfg.now, cfg.scheduleStartDate, countdownActive);
  console.log(
    `Marketing agent run: pillar=${plan.pillar} firstPost=${plan.isFirstPost} ` +
      `ordinal=${plan.ordinal} countdownActive=${countdownActive} ` +
      `generateImage=${plan.generateImage}`
  );

  // Milestone posts read the live stats/global doc (read-only).
  let stats = null;
  if (plan.pillar === PILLARS.MILESTONE) {
    stats = await readStats(cfg.statsDocPath, cfg.firestoreDatabaseId);
  }

  const client = gemini.createClient(cfg.geminiApiKey);

  const textPrompt = buildTextPrompt(plan.pillar, {
    siteUrl: cfg.siteUrl,
    facebookUrl: cfg.facebookUrl,
    stats,
    now: cfg.now,
  });
  const postText = await gemini.generateText(client, cfg.textModel, textPrompt);

  // Only the community/awareness pillar gets a generated illustration.
  let image = null;
  if (plan.generateImage) {
    try {
      const imagePrompt = buildImagePrompt(plan.ordinal);
      image = await gemini.generateImage(client, cfg.imageModel, imagePrompt);
      if (!image) console.warn('Image model returned no image; sending text only.');
    } catch (err) {
      console.error('Image generation failed; sending text only:', err.message);
    }
  }

  await sendDraft({
    fromEmail: cfg.fromEmail,
    resendApiKey: cfg.resendApiKey,
    recipientEmail: cfg.recipientEmail,
    pillar: plan.pillar,
    isFirstPost: plan.isFirstPost,
    postText,
    image,
    listingPhotoReminder: plan.pillar === PILLARS.LISTING_SPOTLIGHT,
    now: cfg.now,
  });

  console.log(`Draft emailed to ${cfg.recipientEmail} (image=${Boolean(image)}).`);
  return { pillar: plan.pillar, hasImage: Boolean(image) };
}

async function main() {
  try {
    await run();
  } catch (err) {
    console.error('Marketing agent run failed:', err);
    process.exitCode = 1; // non-zero → the GitHub Actions step (and run) fails
  }
}

// Run immediately when invoked directly (`node run.js`), but not when required
// by the unit tests.
if (require.main === module) {
  main();
}

module.exports = { run, main };
