data "google_project" "this" {
  project_id = var.project_id
}

locals {
  # APIs the pipeline needs. Firestore/Firebase/Pub/Sub are already enabled on
  # this project; the rest are enabled here (or manually — see README) so a
  # clean apply works end to end.
  required_apis = [
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "cloudscheduler.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
  ]

  function_env = {
    GMAIL_SENDER           = var.gmail_sender
    RECIPIENT_EMAIL        = var.recipient_email
    SCHEDULE_START_DATE    = var.schedule_start_date
    LAUNCH_COUNTDOWN_UNTIL = var.launch_countdown_until
    SITE_URL               = var.site_url
    FACEBOOK_URL           = var.facebook_url
    GEMINI_TEXT_MODEL      = var.gemini_text_model
    GEMINI_IMAGE_MODEL     = var.gemini_image_model
    STATS_DOC_PATH         = var.stats_doc_path
    FIRESTORE_DATABASE_ID  = var.firestore_database_id
  }
}

resource "google_project_service" "apis" {
  for_each = var.enable_apis ? toset(local.required_apis) : toset([])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Service account for the function (least privilege).
# ---------------------------------------------------------------------------

resource "google_service_account" "agent" {
  project      = var.project_id
  account_id   = "marketing-agent-fn"
  display_name = "NoHungryPets Marketing Draft Agent (Cloud Function)"
}

# Read-only Firestore access for the milestone/stat pillar (stats/global).
resource "google_project_iam_member" "firestore_viewer" {
  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.agent.email}"
}

# ---------------------------------------------------------------------------
# Secret Manager — values supplied at apply time, never committed.
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret" "gemini_api_key" {
  project   = var.project_id
  secret_id = "marketing-agent-gemini-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "gemini_api_key" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key
}

resource "google_secret_manager_secret" "gmail_app_password" {
  project   = var.project_id
  secret_id = "marketing-agent-gmail-app-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "gmail_app_password" {
  secret      = google_secret_manager_secret.gmail_app_password.id
  secret_data = var.gmail_app_password
}

# Allow the function SA to read only these two secrets.
resource "google_secret_manager_secret_iam_member" "gemini_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.gemini_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent.email}"
}

resource "google_secret_manager_secret_iam_member" "gmail_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.gmail_app_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.agent.email}"
}

# ---------------------------------------------------------------------------
# Function source: zip ../function and upload to a private bucket.
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "source" {
  project                     = var.project_id
  name                        = "${var.project_id}-marketing-agent-src"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
}

data "archive_file" "source" {
  type        = "zip"
  source_dir  = "${path.module}/../function"
  output_path = "${path.module}/build/function-source.zip"
  excludes    = ["node_modules", "build", ".git", "*.log"]
}

resource "google_storage_bucket_object" "source" {
  # Hash suffix forces a new object (and redeploy) whenever the source changes.
  name   = "function-source-${data.archive_file.source.output_md5}.zip"
  bucket = google_storage_bucket.source.name
  source = data.archive_file.source.output_path
}

# ---------------------------------------------------------------------------
# Pub/Sub topic (Scheduler -> topic -> function).
# ---------------------------------------------------------------------------

resource "google_pubsub_topic" "trigger" {
  project    = var.project_id
  name       = "marketing-agent-trigger"
  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------------------
# IAM required for the Pub/Sub-triggered Eventarc/2nd-gen function.
# ---------------------------------------------------------------------------

# The Pub/Sub service agent must be able to mint tokens for the trigger SA.
resource "google_project_iam_member" "pubsub_token_creator" {
  project = var.project_id
  role    = "roles/iam.serviceAccountTokenCreator"
  member  = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# The function's SA needs to receive events and invoke the underlying Cloud Run service.
resource "google_project_iam_member" "agent_event_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.agent.email}"
}

resource "google_project_iam_member" "agent_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.agent.email}"
}

# ---------------------------------------------------------------------------
# Cloud Function (2nd gen).
# ---------------------------------------------------------------------------

resource "google_cloudfunctions2_function" "agent" {
  project  = var.project_id
  name     = "marketing-agent"
  location = var.region

  build_config {
    runtime     = "nodejs20"
    entry_point = "marketingAgent"
    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.source.name
      }
    }
  }

  service_config {
    max_instance_count    = 1
    min_instance_count    = 0
    available_memory      = "512Mi"
    timeout_seconds       = 300
    service_account_email = google_service_account.agent.email
    environment_variables = local.function_env

    dynamic "secret_environment_variables" {
      for_each = {
        GEMINI_API_KEY     = google_secret_manager_secret.gemini_api_key.secret_id
        GMAIL_APP_PASSWORD = google_secret_manager_secret.gmail_app_password.secret_id
      }
      content {
        key        = secret_environment_variables.key
        project_id = var.project_id
        secret     = secret_environment_variables.value
        version    = "latest"
      }
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.trigger.id
    retry_policy          = "RETRY_POLICY_DO_NOT_RETRY"
    service_account_email = google_service_account.agent.email
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.gemini_accessor,
    google_secret_manager_secret_iam_member.gmail_accessor,
    google_project_iam_member.pubsub_token_creator,
    google_project_iam_member.agent_event_receiver,
    google_project_iam_member.agent_run_invoker,
  ]
}

# ---------------------------------------------------------------------------
# Cloud Scheduler -> Pub/Sub.
# ---------------------------------------------------------------------------

# Cloud Scheduler's service agent needs to publish to the topic.
resource "google_pubsub_topic_iam_member" "scheduler_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.trigger.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}

resource "google_cloud_scheduler_job" "schedule" {
  project   = var.project_id
  name      = "marketing-agent-schedule"
  region    = var.region
  schedule  = var.scheduler_cron
  time_zone = var.scheduler_time_zone

  pubsub_target {
    topic_name = google_pubsub_topic.trigger.id
    data       = base64encode("{\"source\":\"cloud-scheduler\"}")
  }

  depends_on = [
    google_project_service.apis,
    google_pubsub_topic_iam_member.scheduler_publisher,
  ]
}
