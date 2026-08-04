'use strict';

/**
 * Email delivery of the finished draft via the Resend HTTP API (free tier:
 * 100/day, 3,000/month — nowhere near this agent's ~12-16/month volume). No
 * Gmail App Password, no SMTP, no extra npm dependency — just Node 20's
 * built-in `fetch`. The post copy is shown inline; any generated illustration
 * is embedded inline (as a base64 data URI — Resend's API doesn't support
 * SMTP-style CID references) AND attached so the owner can download it and
 * upload it to Facebook.
 *
 * On Resend's free tier, sending from the sandbox address (onboarding@resend.dev,
 * the default) only delivers to the email address you signed up to Resend
 * with — see README for details and the optional domain-verification upgrade.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

function createClient(resendApiKey) {
  return {
    async send(payload) {
      const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Resend API error ${res.status}: ${body}`);
      }
      return res.json();
    },
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {object} opts
 * @param {string} opts.fromEmail
 * @param {string} opts.resendApiKey
 * @param {string} opts.recipientEmail
 * @param {string} opts.pillar
 * @param {boolean} opts.isFirstPost
 * @param {string} opts.postText
 * @param {{data:Buffer,mimeType:string}|null} opts.image
 * @param {boolean} opts.listingPhotoReminder  Ask owner to attach a real photo.
 * @param {Date}   opts.now
 * @param {object} [client]  injectable for testing (must expose `.send(payload)`)
 */
async function sendDraft(opts, client) {
  const {
    fromEmail,
    resendApiKey,
    recipientEmail,
    pillar,
    isFirstPost,
    postText,
    image,
    listingPhotoReminder,
    now = new Date(),
  } = opts;

  const resend = client || createClient(resendApiKey);

  const dateLabel = now.toISOString().slice(0, 10);
  const pillarLabel = isFirstPost ? 'how-to (launch)' : pillar;
  const subject = `NoHungryPets FB draft — ${pillarLabel} — ${dateLabel}`;

  const ext = image && image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const imageFilename = `nohungrypets-${pillar}-${dateLabel}.${ext}`;
  const attachments = [];
  let imageHtml = '';

  if (image) {
    const base64Content = image.data.toString('base64');
    attachments.push({
      filename: imageFilename,
      content: base64Content,
    });
    imageHtml =
      `<p style="margin:16px 0 6px;font-weight:600">Generated illustration ` +
      `(also attached — download &amp; upload to Facebook):</p>` +
      `<img src="data:${image.mimeType};base64,${base64Content}" ` +
      `alt="Generated illustration" style="max-width:100%;border-radius:8px" />`;
  }

  const reminderHtml = listingPhotoReminder
    ? `<p style="margin:16px 0;padding:12px;background:#fff6e5;border-radius:8px">` +
      `<strong>Reminder:</strong> this is a listing-spotlight post — attach a ` +
      `<em>real photo from an actual current listing</em> when you post it. ` +
      `(No illustration is generated for these on purpose.)</p>`
    : '';

  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;max-width:640px;` +
    `margin:0 auto;color:#222">` +
    `<p style="color:#666;margin:0 0 4px">Facebook draft &middot; pillar: ` +
    `<strong>${escapeHtml(pillarLabel)}</strong> &middot; ${dateLabel}</p>` +
    `<p style="color:#666;margin:0 0 16px">Review, tweak if needed, then copy ` +
    `into the NoHungryPets Facebook Page. Nothing is auto-posted.</p>` +
    `<div style="white-space:pre-wrap;padding:16px;border:1px solid #e5e5e5;` +
    `border-radius:8px;background:#fafafa;line-height:1.5">` +
    `${escapeHtml(postText)}</div>` +
    reminderHtml +
    imageHtml +
    `</div>`;

  const textParts = [
    `NoHungryPets Facebook draft (pillar: ${pillarLabel}, ${dateLabel})`,
    'Review and copy into Facebook manually — nothing is auto-posted.',
    '',
    '--- POST COPY ---',
    postText,
  ];
  if (listingPhotoReminder) {
    textParts.push(
      '',
      'REMINDER: listing-spotlight post — attach a real photo from an actual ' +
        'current listing (no illustration generated for these).'
    );
  }
  if (image) {
    textParts.push('', 'An illustration is attached to this email.');
  }

  return resend.send({
    from: `NoHungryPets Marketing Agent <${fromEmail}>`,
    to: [recipientEmail],
    subject,
    text: textParts.join('\n'),
    html,
    attachments,
  });
}

module.exports = { createClient, sendDraft, escapeHtml };
