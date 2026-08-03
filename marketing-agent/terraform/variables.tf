variable "project_id" {
  description = "GCP project that hosts NoHungryPets Firestore/Firebase."
  type        = string
  default     = "nohungrypets"
}

variable "region" {
  description = "Region for the Cloud Function (2nd gen), source bucket, and Eventarc trigger."
  type        = string
  default     = "europe-west1"
}

variable "scheduler_time_zone" {
  description = "IANA time zone for the Cloud Scheduler cron (site is UK-focused)."
  type        = string
  default     = "Europe/London"
}

variable "scheduler_cron" {
  description = "Cron for the draft cadence. Default: Mon/Wed/Fri 09:00."
  type        = string
  default     = "0 9 * * 1,3,5"
}

# ---------------------------------------------------------------------------
# Secrets — supplied at apply time, never committed. No defaults on purpose.
# ---------------------------------------------------------------------------

variable "gemini_api_key" {
  description = "Google AI Studio (Gemini) API key, created under the nohungrypets project."
  type        = string
  sensitive   = true
}

variable "gmail_app_password" {
  description = "Gmail App Password for the sending account (Nodemailer)."
  type        = string
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Runtime (non-secret) configuration passed to the function as env vars.
# ---------------------------------------------------------------------------

variable "gmail_sender" {
  description = "Gmail account used to send the drafts."
  type        = string
  default     = "agipasieka79@gmail.com"
}

variable "recipient_email" {
  description = "Where the drafts are emailed."
  type        = string
  default     = "agipasieka79@gmail.com"
}

variable "schedule_start_date" {
  description = "First scheduled Mon/Wed/Fri slot (YYYY-MM-DD). Drives the one-off how-to post and the stateless rotation."
  type        = string
  default     = "2026-08-04"
}

variable "launch_countdown_until" {
  description = "ISO date (YYYY-MM-DD). The launch-countdown pillar is active while now < this date. Empty disables it."
  type        = string
  default     = ""
}

variable "site_url" {
  description = "Public site URL embedded in posts."
  type        = string
  default     = "https://nohungrypets.co.uk"
}

variable "facebook_url" {
  description = "Facebook Page URL."
  type        = string
  default     = "https://www.facebook.com/nohungrypets"
}

variable "gemini_text_model" {
  description = "Gemini model used for post copy."
  type        = string
  default     = "gemini-2.5-flash"
}

variable "gemini_image_model" {
  description = "Gemini image model (nano banana) for illustrations."
  type        = string
  default     = "gemini-2.5-flash-image"
}

variable "stats_doc_path" {
  description = "Firestore doc path for milestone numbers."
  type        = string
  default     = "stats/global"
}

variable "firestore_database_id" {
  description = "Firestore database id."
  type        = string
  default     = "(default)"
}

variable "enable_apis" {
  description = "Whether Terraform should enable the required GCP APIs. Set false if you prefer to enable them manually with gcloud."
  type        = bool
  default     = true
}
