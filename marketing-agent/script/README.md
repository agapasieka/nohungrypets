# NoHungryPets — Marketing Draft Agent (GitHub Actions)

A tiny, **fully free** pipeline that drafts Facebook posts (and the occasional
illustration) for the NoHungryPets Page and **emails them to the owner for
manual review**. Nothing is auto-posted.

> **Zero billing account.** This runs as a scheduled **GitHub Actions** workflow,
> not on GCP compute. Cloud Functions 2nd gen, Cloud Scheduler, Pub/Sub and
> Secret Manager all require the GCP project to be on the Blaze (pay-as-you-go)
> plan — even at $0 usage — which conflicts with this project's policy of
> staying on the free Firebase **Spark** plan with no billing account attached.
> Public-repo Actions minutes are free and unlimited, and GitHub repo secrets
> need no billing account. See the plan doc for the full rationale.

- **Trigger**: GitHub Actions `schedule` cron (`0 8 * * 1,3,5`) + a
  `workflow_dispatch` button for manual test runs.
  See [`../../.github/workflows/marketing-agent.yml`](../../.github/workflows/marketing-agent.yml).
- **Text**: Gemini (`gemini-2.5-flash`) writes the post copy.
- **Images**: Gemini 2.5 Flash Image ("nano banana") generates a warm, soft,
  "sharing is caring" illustration — **only** on the ~1-in-3 community posts.
- **Stats**: milestone posts read the live `stats/global` Firestore doc
  (read-only, via the Admin SDK + a dedicated read-only service account).
- **Delivery**: [Resend](https://resend.com)'s HTTP API (free tier: 100/day,
  3,000/month) emails the draft to `info.nohungrypets@gmail.com` (copy inline;
  image inline as a data URI + attached). No SMTP, no Gmail App Password, no
  extra npm dependency — just Node 20's built-in `fetch`.

> **Why Resend instead of a Gmail App Password?** App Passwords require
> 2-Step Verification, and even with 2SV on, Google silently restricts App
> Password creation for some accounts with no user-facing fix ("The setting
> you are looking for is not available for your account"). Resend sidesteps
> this entirely — one API key, no Google account-security dependency.

## Scheduling & the winter timezone drift

GitHub Actions cron is **UTC only** — it has no timezone support. `0 8 * * 1,3,5`
= 08:00 UTC Mon/Wed/Fri:

- **Summer (BST, ~late Mar–late Oct):** 08:00 UTC = **09:00 Europe/London** ✅ the intended slot.
- **Winter (GMT):** UK local time == UTC, so it lands at **08:00 local** instead of 09:00.

This ~1-hour winter drift is an **accepted trade-off**, not a bug — an hour
either way is immaterial for a draft a human reviews before posting, and Actions
simply can't do timezones. (GitHub may also delay scheduled runs by a few minutes
under load.)

## Content rotation

The first ever scheduled slot sends a one-off **"how to use NoHungryPets"**
post (3–4 numbered steps: sign up → post what you don't need → find what you do
→ arrange a handover). After that it walks a 9-slot pillar cycle:

| Pillar | Image? | Notes |
| --- | --- | --- |
| `listing_spotlight` | No | Copy stays generic; owner attaches a **real listing photo** (the email reminds them). |
| `community` | **Yes** | Emotional "sharing is caring" post — the illustrated one (3/9 of the cycle ≈ 1 in 3). |
| `pet_care` | No | A practical dog/cat care tip. |
| `milestone` | No | Reads live `stats/global` numbers; degrades to a numbers-free post if unavailable. |
| `launch_countdown` | No | Only mixed in while `LAUNCH_COUNTDOWN_UNTIL` is in the future; then it drops itself. |

Rotation is **stateless** — derived from how many Mon/Wed/Fri slots have elapsed
since `SCHEDULE_START_DATE` — so the agent never needs to *write* to Firestore
(least privilege: `roles/datastore.viewer` only).

## Owner setup (one-time)

Nothing here requires a GCP billing account.

### 1. Add the GitHub Actions repo secrets

In the `agapasieka/nohungrypets` repo → **Settings → Secrets and variables →
Actions → New repository secret**, add:

| Secret | Value |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio (Gemini) API key. Create at <https://aistudio.google.com/app/apikey>, selecting the `nohungrypets` project in the picker (free tier). |
| `RESEND_API_KEY` | Resend API key — see step 2 below. |
| `FIREBASE_SA_KEY` | The read-only Firestore service-account JSON key from step 3 — paste the **entire JSON file contents** (raw). Base64 also accepted. |

(`FROM_EMAIL` / `RECIPIENT_EMAIL` default to sensible values in code, so
they're optional. Any of the non-secret settings can be overridden without
editing YAML by adding a repo **variable** of the same name under the same
Settings page → *Variables* tab — e.g. `SCHEDULE_START_DATE`,
`LAUNCH_COUNTDOWN_UNTIL`.)

### 2. Sign up for Resend and grab an API key

1. Go to <https://resend.com> and sign up **using `info.nohungrypets@gmail.com`**
   (free, no credit card).
2. Dashboard → **API Keys** → **Create API Key** → paste the value into the
   `RESEND_API_KEY` repo secret above.

**Sandbox limitation (default, zero setup):** sending `from` the shared
`onboarding@resend.dev` address only delivers **to the email address you
signed up to Resend with** — which is fine here since drafts only ever go to
`info.nohungrypets@gmail.com`, the same address. If you ever want to send from a
`@nohungrypets.co.uk` address or to a different recipient, verify the
`nohungrypets.co.uk` domain in Resend (Dashboard → Domains → Add Domain, then
add the DNS records it gives you — same place `CNAME` already lives for GitHub
Pages) and set the `FROM_EMAIL` repo variable to an address at that domain.
Not required for the current single-recipient setup.

### 3. Create the read-only Firestore service account + key

Milestone posts read `stats/global`. A GitHub-hosted runner has no built-in GCP
identity, so we use a dedicated service account scoped to **read-only** Firestore.
Creating a service account, binding IAM, and reading Firestore in Native mode all
work on the free **Spark** plan — **no billing account required.**

Run these once (Cloud Shell or any machine with `gcloud` logged in as a
project owner/editor):

```bash
PROJECT=nohungrypets
SA=marketing-agent-reader

# a) Create the service account
gcloud iam service-accounts create "$SA" \
  --project="$PROJECT" \
  --display-name="NoHungryPets Marketing Agent (read-only Firestore)"

# b) Grant ONLY read-only Firestore/Datastore access (least privilege)
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/datastore.viewer"

# c) Generate a JSON key (this file IS a secret — do not commit it)
gcloud iam service-accounts keys create ./marketing-agent-sa-key.json \
  --iam-account="${SA}@${PROJECT}.iam.gserviceaccount.com"
```

Then paste the **contents** of `marketing-agent-sa-key.json` into the
`FIREBASE_SA_KEY` repo secret (step 1) and delete the local file. The `.gitignore`
here already ignores `*-sa-key.json` and `serviceAccount*.json` as a safety net.

### 4. Test it (manual run)

Repo → **Actions** tab → **"Marketing draft agent"** workflow → **Run workflow**
(the `workflow_dispatch` button). On/near the launch date this sends the one-off
**how-to** draft to `info.nohungrypets@gmail.com`. Confirm the email arrives, reads
well, and — on community posts — the illustration renders. After that it runs
automatically on the Mon/Wed/Fri schedule.

## Environment variables

Injected by the workflow at run time.

| Var | Source | Default | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | **repo secret** | — | Google AI Studio API key (free tier). |
| `RESEND_API_KEY` | **repo secret** | — | Resend API key (free tier). |
| `FIREBASE_SA_KEY` | **repo secret** | — | Read-only Firestore SA JSON key (raw or base64). Needed only for milestone posts. |
| `FROM_EMAIL` | var | `onboarding@resend.dev` | Resend sender address (sandbox default — see step 2). |
| `RECIPIENT_EMAIL` | var | `info.nohungrypets@gmail.com` | Where drafts are delivered. |
| `SCHEDULE_START_DATE` | var | `2026-08-04` | First scheduled slot (drives the how-to + rotation). |
| `LAUNCH_COUNTDOWN_UNTIL` | var | *(empty)* | ISO date; countdown pillar active while now < this. |
| `SITE_URL` | var | `https://nohungrypets.co.uk` | Link embedded in posts. |
| `FACEBOOK_URL` | var | `https://www.facebook.com/nohungrypets` | Page URL. |
| `GEMINI_TEXT_MODEL` | var | `gemini-2.5-flash` | Override text model. |
| `GEMINI_IMAGE_MODEL` | var | `gemini-2.5-flash-image` | Override image model. |
| `STATS_DOC_PATH` | var | `stats/global` | Firestore doc for milestone numbers. |
| `FIRESTORE_DATABASE_ID` | var | `(default)` | Firestore database id. |

## Local development

```bash
npm install
npm test          # 16 unit tests (node --test) for rotation + prompt assembly
node --check run.js
```

To do a real end-to-end run locally, copy `.env.example`, fill in real values
(never commit them), then:

```bash
set -a; source ./.env; set +a
node run.js
```

Locally you can omit `FIREBASE_SA_KEY` and instead use your own gcloud
credentials for the Firestore read (`gcloud auth application-default login`) —
the script falls back to Application Default Credentials when the secret is
absent.
