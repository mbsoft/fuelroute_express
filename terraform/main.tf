terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# Artifact Registry repo for Docker images
resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = var.service_name
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# Store Cloud SQL database password in Secret Manager
resource "google_secret_manager_secret" "db_password" {
  secret_id = "${var.service_name}-db-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = var.db_password
}

# Store NextBillion.ai API key in Secret Manager
resource "google_secret_manager_secret" "nextbillion_key" {
  secret_id = "${var.service_name}-nextbillion-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "nextbillion_key" {
  secret      = google_secret_manager_secret.nextbillion_key.id
  secret_data = var.nextbillion_api_key
}

# Service account for Cloud Run
resource "google_service_account" "cloudrun" {
  account_id   = "${var.service_name}-sa"
  display_name = "Cloud Run service account for ${var.service_name}"
}

# Grant the service account access to secrets
resource "google_secret_manager_secret_iam_member" "cloudrun_db_password_access" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "cloudrun_nextbillion_access" {
  secret_id = google_secret_manager_secret.nextbillion_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Allow the service account to connect to Cloud SQL
resource "google_project_iam_member" "cloudrun_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Cloud Run service
resource "google_cloud_run_v2_service" "app" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloudrun.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    # Mounts the Cloud SQL unix socket at /cloudsql/<INSTANCE_CONNECTION_NAME>
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloud_sql_connection_name]
      }
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.service_name}/${var.service_name}:latest"

      ports {
        container_port = 3000
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "INSTANCE_CONNECTION_NAME"
        value = var.cloud_sql_connection_name
      }

      env {
        name  = "DB_NAME"
        value = var.db_name
      }

      env {
        name  = "DB_USER"
        value = var.db_user
      }

      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "NEXTBILLION_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.nextbillion_key.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.db_password,
    google_secret_manager_secret_version.nextbillion_key,
    google_secret_manager_secret_iam_member.cloudrun_db_password_access,
    google_secret_manager_secret_iam_member.cloudrun_nextbillion_access,
    google_project_iam_member.cloudrun_cloudsql_client,
  ]
}

# Allow unauthenticated access (public API)
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
