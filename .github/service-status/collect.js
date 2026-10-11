// Scheduled service-status collector for the /platform-health dashboard.
// Runs in GitHub Actions on a cron. It gathers a lightweight status snapshot
// from the services the site depends on and writes it to a single Firestore
// doc (_meta/serviceStatus) that the admin-only /platform-health page reads.
//
// Why a server job and not the browser: every API below needs a secret key,
// and /platform-health is public static HTML — a key in that JS would be
// exposed. So the keys stay here (GitHub Secrets) and only the resulting,
// non-sensitive summary is written to Firestore.
//
// Secrets / env used:
//   FIREBASE_SA_KEY    - full JSON of a Firebase service account key
//   GITHUB_TOKEN       - provided automatically by Actions (reads workflow runs)
//   GITHUB_REPOSITORY  - "owner/repo", provided automatically by Actions
//   RESEND_API_KEY     - Resend API key (same one the email jobs use)

const admin = require('firebase-admin');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(requireEnv('FIREBASE_SA_KEY'));
} catch (err) {
  console.error('FIREBASE_SA_KEY is not valid JSON:', err.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const STATUS_REF = db.collection('_meta').doc('serviceStatus');

// ── GitHub Actions ────────────────────────────────────────
// Latest run per workflow, plus a count of open Dependabot alerts.
async function collectGitHub() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    return { ok: false, error: 'GITHUB_REPOSITORY or GITHUB_TOKEN not set' };
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nohungrypets-service-status'
  };

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs?per_page=100`,
      { headers }
    );
    if (!res.ok) {
      return { ok: false, error: `Actions API ${res.status}` };
    }
    const body = await res.json();
    const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];

    // Runs come back newest-first, so the first run seen for a workflow name
    // is its most recent one.
    const latestByWorkflow = new Map();
    for (const r of runs) {
      if (!latestByWorkflow.has(r.name)) {
        latestByWorkflow.set(r.name, {
          name: r.name,
          conclusion: r.conclusion || r.status || 'unknown',
          when: r.updated_at || r.created_at || null,
          url: r.html_url || null
        });
      }
    }
    const workflows = Array.from(latestByWorkflow.values())
      .sort((a, b) => (b.when || '').localeCompare(a.when || ''))
      .slice(0, 12);
    const failedCount = workflows.filter(w => w.conclusion === 'failure').length;

    // Open Dependabot alerts — best-effort; the token may lack permission,
    // in which case we report null rather than failing the whole job.
    let alerts = null;
    try {
      const aRes = await fetch(
        `https://api.github.com/repos/${repo}/dependabot/alerts?state=open&per_page=100`,
        { headers }
      );
      if (aRes.ok) {
        const list = await aRes.json();
        alerts = Array.isArray(list) ? list.length : null;
      }
    } catch (_) { /* leave alerts null */ }

    return { ok: failedCount === 0, failedCount, alerts, workflows };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Resend ────────────────────────────────────────────────
// Count emails sent this calendar month (UTC) and the most recent send.
function parseResendDate(s) {
  if (typeof s !== 'string') return null;
  // e.g. "2026-04-03 22:13:42.674981+00" -> ISO-ish the Date ctor accepts.
  let t = s.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

async function collectResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };

  const headers = { Authorization: `Bearer ${key}` };
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let sentThisMonth = 0;
  let sentToday = 0;
  let lastSendAt = null;
  let after = null;
  let capped = false;
  const MAX_PAGES = 5; // up to 500 most-recent emails

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL('https://api.resend.com/emails');
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);

      const res = await fetch(url, { headers });
      if (!res.ok) {
        return { ok: false, error: `Resend API ${res.status}` };
      }
      const body = await res.json();
      const data = Array.isArray(body.data) ? body.data : [];
      if (data.length === 0) break;

      for (const email of data) {
        const d = parseResendDate(email.created_at);
        if (d) {
          if (!lastSendAt || d > lastSendAt) lastSendAt = d;
          if (d >= monthStart) sentThisMonth++;
          if (d >= dayStart) sentToday++;
        }
      }

      after = data[data.length - 1].id;
      if (!body.has_more) break;
      if (page === MAX_PAGES - 1 && body.has_more) capped = true;
    }
    return {
      ok: true,
      sentToday,
      sentThisMonth,
      lastSendAt: lastSendAt ? lastSendAt.toISOString() : null,
      capped
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const [github, resend] = await Promise.all([collectGitHub(), collectResend()]);

  await STATUS_REF.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    github,
    resend
  });

  console.log('Service status written:', JSON.stringify({ github, resend }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Service-status collection failed:', err);
    process.exit(1);
  });
