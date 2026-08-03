output "function_name" {
  description = "Deployed Cloud Function name."
  value       = google_cloudfunctions2_function.agent.name
}

output "function_service_account" {
  description = "Runtime service account (granted read-only Firestore + secret access)."
  value       = google_service_account.agent.email
}

output "pubsub_topic" {
  description = "Pub/Sub topic the scheduler publishes to."
  value       = google_pubsub_topic.trigger.id
}

output "scheduler_job" {
  description = "Cloud Scheduler job name — trigger it manually to test."
  value       = google_cloud_scheduler_job.schedule.name
}

output "manual_test_command" {
  description = "Run this to fire a draft immediately (first run sends the how-to post)."
  value       = "gcloud scheduler jobs run ${google_cloud_scheduler_job.schedule.name} --location=${var.region} --project=${var.project_id}"
}
