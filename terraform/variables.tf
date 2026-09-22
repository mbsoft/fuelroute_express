variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run"
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "fuelroute-express"
}

variable "cloud_sql_connection_name" {
  description = "Cloud SQL instance connection name (project:region:instance)"
  type        = string
}

variable "db_name" {
  description = "Postgres database name"
  type        = string
}

variable "db_user" {
  description = "Postgres user"
  type        = string
}

variable "db_password" {
  description = "Postgres password"
  type        = string
  sensitive   = true
}

variable "nextbillion_api_key" {
  description = "NextBillion.ai API key"
  type        = string
  sensitive   = true
}
