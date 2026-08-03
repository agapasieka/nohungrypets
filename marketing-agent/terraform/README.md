# NoHungryPets — Marketing Draft Agent (Terraform)

Deploys the whole free-tier pipeline into the existing **`nohungrypets`** GCP
project (project number `145249046661`):

- Pub/Sub topic + Cloud Scheduler job (`0 9 * * 1,3,5`, Europe/London)
- Cloud Function (2nd gen, Node.js 20) built from `../function`
- Secret Manager secrets for the Gemini API key and Gmail App Password
- A dedicated least-privilege service account:
  - `roles/datastore.viewer` (read-only Firestore — `stats/global`)
  - `roles/secretmanager.secretAccessor` on **only** the two secrets above
  - the Eventarc/Run bindings a Pub/Sub-triggered 2nd-gen function needs

Everything here fits comfortably inside the perpetual GCP free tiers at
~12 invocations/month.

## Prerequisites — the two manual secrets (owner only)

These are account-level steps Terraform cannot do for you:

1. **Gemini API key** — go to <https://aistudio.google.com/app/apikey>, and when
   creating the key **select the `nohungrypets` project in the picker** (do not
   let it auto-create a new `gen-lang-client-*` project). Free tier, no card.
2. **Gmail App Password** — with 2-Step Verification enabled on
   `agipasieka79@gmail.com`, create one at
   <https://myaccount.google.com/apppasswords> (16 characters). This is what
   Nodemailer uses to send.

Keep both out of git — pass them at apply time (below).

## Deploy

```bash
# 1. Authenticate (owner's account with Editor/Owner on the project)
gcloud auth application-default login
gcloud config set project nohungrypets

# 2. (Optional) enable the required APIs yourself instead of letting Terraform
#    do it (Terraform enables them by default via enable_apis=true):
#    gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com \
#      run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
#      cloudscheduler.googleapis.com secretmanager.googleapis.com \
#      artifactregistry.googleapis.com firestore.googleapis.com

# 3. Init + apply, supplying the two secrets
cd marketing-agent/terraform
terraform init
terraform apply \
  -var="gemini_api_key=YOUR_GEMINI_KEY" \
  -var="gmail_app_password=YOUR_GMAIL_APP_PASSWORD"
```

(Or copy `terraform.tfvars.example` → `terraform.tfvars`, fill it in, and just
run `terraform apply`. `terraform.tfvars` is gitignored.)

## Test it

Fire one draft immediately (the **first** run always sends the one-off
"how to use NoHungryPets" post; subsequent runs walk the pillar rotation):

```bash
terraform output -raw manual_test_command | bash
# or:
gcloud scheduler jobs run marketing-agent-schedule --location=europe-west1 --project=nohungrypets
```

Check `agipasieka79@gmail.com` for the draft, and the function logs with:

```bash
gcloud functions logs read marketing-agent --region=europe-west1 --gen2 --project=nohungrypets
```

## Notes

- Set `launch_countdown_until` to ~2 weeks after launch to weave in the
  countdown-hype pillar; clear it (or let the date pass) to drop it automatically.
- Redeploying: any change under `../function` changes the source hash and a
  fresh `terraform apply` rebuilds and redeploys the function.
- To roll a secret, `terraform apply` with the new value creates a new version
  (`version = "latest"` is referenced by the function).
- `terraform destroy` tears the whole pipeline down.
