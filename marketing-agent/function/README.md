# NoHungryPets — Marketing Draft Agent (Cloud Function)

A tiny, **fully free-tier** GCP pipeline that drafts Facebook posts (and the
occasional illustration) for the NoHungryPets Page and **emails them to the
owner for manual review**. Nothing is auto-posted.

- **Trigger**: Cloud Scheduler (`0 9 * * 1,3,5` — Mon/Wed/Fri 09:00 Europe/London)
  → Pub/Sub → this Cloud Function (2nd gen, Node.js).
- **Text**: Gemini (`gemini-2.5-flash`) writes the post copy.
- **Images**: Gemini 2.5 Flash Image ("nano banana") generates a warm, soft,
  "sharing is caring" illustration — **only** on the ~1-in-3 community posts.
- **Stats**: milestone posts read the live `stats/global` Firestore doc
  (read-only, via the Admin SDK + the function's own service account).
- **Delivery**: Nodemailer over Gmail (App Password) emails the draft to
  `agipasieka79@gmail.com` (copy inline; image inline + attached).

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
since `SCHEDULE_START_DATE` — so the function never needs to *write* to Firestore
(least privilege: `roles/datastore.viewer` only).

## Environment variables

Injected by Terraform at deploy time (see `../terraform`).

| Var | Source | Default | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | **Secret Manager** | — | Google AI Studio API key (free tier). |
| `GMAIL_APP_PASSWORD` | **Secret Manager** | — | Gmail App Password for the sender account. |
| `GMAIL_SENDER` | env | `agipasieka79@gmail.com` | Gmail account used to send. |
| `RECIPIENT_EMAIL` | env | `agipasieka79@gmail.com` | Where drafts are delivered. |
| `SCHEDULE_START_DATE` | env | `2026-08-04` | First scheduled slot (drives the how-to + rotation). |
| `LAUNCH_COUNTDOWN_UNTIL` | env | *(empty)* | ISO date; countdown pillar active while now < this. |
| `SITE_URL` | env | `https://nohungrypets.co.uk` | Link embedded in posts. |
| `FACEBOOK_URL` | env | `https://www.facebook.com/nohungrypets` | Page URL. |
| `GEMINI_TEXT_MODEL` | env | `gemini-2.5-flash` | Override text model. |
| `GEMINI_IMAGE_MODEL` | env | `gemini-2.5-flash-image` | Override image model. |
| `STATS_DOC_PATH` | env | `stats/global` | Firestore doc for milestone numbers. |
| `FIRESTORE_DATABASE_ID` | env | `(default)` | Firestore database id. |

## Local development

```bash
npm install
npm test        # unit tests (node --test) for rotation + prompt assembly
node --check index.js
```

To run the function locally against real Gemini/Gmail you'd export the env vars
above and `npm start` (Functions Framework), then POST a CloudEvent to
`localhost:8080`. Deployment is handled by Terraform — see `../terraform/README.md`.
