#!/usr/bin/env bash
set -euo pipefail

# Configuration — override with env vars if needed
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="fuelroute-express"
REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}"
IMAGE="${REPO}/${SERVICE_NAME}:latest"

echo "Project:  ${PROJECT_ID}"
echo "Region:   ${REGION}"
echo "Image:    ${IMAGE}"
echo ""

# Ensure Artifact Registry repo exists
if ! gcloud artifacts repositories describe "${SERVICE_NAME}" \
  --location="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  echo "Creating Artifact Registry repository..."
  gcloud artifacts repositories create "${SERVICE_NAME}" \
    --repository-format=docker \
    --location="${REGION}" \
    --project="${PROJECT_ID}"
fi

# Authenticate Docker with Artifact Registry
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "Building and pushing ${IMAGE}..."

# Build and push the Docker image
docker build --platform linux/amd64 -t "${IMAGE}" .
docker push "${IMAGE}"

# Deploy to Cloud Run (create or update)
if gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  echo "Updating existing Cloud Run service..."
  gcloud run services update "${SERVICE_NAME}" \
    --region "${REGION}" \
    --image "${IMAGE}" \
    --project "${PROJECT_ID}"
else
  echo "ERROR: Cloud Run service '${SERVICE_NAME}' does not exist in project '${PROJECT_ID}'." >&2
  echo "The service definition (env vars, secrets, service account) is managed by Terraform." >&2
  echo "Create it first with:  cd terraform && terraform apply" >&2
  exit 1
fi

echo ""
echo "Deployed! URL:"
gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)"
