'use strict';

/**
 * NoHungryPets — Free Marketing Draft Agent (Cloud Function, 2nd gen).
 *
 * Triggered by Pub/Sub (fired by Cloud Scheduler on Mon/Wed/Fri 09:00). Each
 * run: pick the day's content pillar, write the Facebook post copy with Gemini,
 * generate an illustration for ~1-in-3 (community) posts, read live community
 * stats for milestone posts, then email the finished draft to the site owner.
 * Nothing is auto-posted — a human reviews and posts manually.
 */

const functions = require('@google-cloud/functions-framework');

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
    gmailSender: cfg.gmailSender,
    gmailAppPassword: cfg.gmailAppPassword,
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

// Pub/Sub-triggered CloudEvent entry point (2nd gen).
functions.cloudEvent('marketingAgent', async () => {
  try {
    await run();
  } catch (err) {
    console.error('Marketing agent run failed:', err);
    throw err; // surface to Cloud Functions for retry/visibility
  }
});

module.exports = { run };
