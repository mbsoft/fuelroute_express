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

# Store Supabase service role key in Secret Manager
resource "google_secret_manager_secret" "supabase_key" {
  secret_id = "${var.service_name}-supabase-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "supabase_key" {
  secret      = google_secret_manager_secret.supabase_key.id
  secret_data = var.supabase_service_role_key
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
resource "google_secret_manager_secret_iam_member" "cloudrun_supabase_access" {
  secret_id = google_secret_manager_secret.supabase_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_secret_manager_secret_iam_member" "cloudrun_nextbillion_access" {
  secret_id = google_secret_manager_secret.nextbillion_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
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

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.service_name}/${var.service_name}:latest"

      ports {
        container_port = 3000
      }

      env {
        name  = "SUPABASE_URL"
        value = var.supabase_url
      }

      env {
        name = "SUPABASE_SERVICE_ROLE_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.supabase_key.secret_id
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
    google_secret_manager_secret_version.supabase_key,
    google_secret_manager_secret_version.nextbillion_key,
    google_secret_manager_secret_iam_member.cloudrun_supabase_access,
    google_secret_manager_secret_iam_member.cloudrun_nextbillion_access,
  ]
}

# Allow unauthenticated access (public API)
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
