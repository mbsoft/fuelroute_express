#!/usr/bin/env bash
set -euo pipefail

# Load variables from terraform outputs
PROJECT_ID=$(cd terraform && terraform output -raw docker_repo | cut -d'/' -f2)
REGION=$(cd terraform && terraform output -raw docker_repo | cut -d'/' -f1 | sed 's/-docker.pkg.dev//')
REPO=$(cd terraform && terraform output -raw docker_repo)
SERVICE_NAME="fuelroute-express"
IMAGE="${REPO}/${SERVICE_NAME}:latest"

echo "Building and pushing ${IMAGE}..."

# Build and push the Docker image
docker build --platform linux/amd64 -t "${IMAGE}" .
docker push "${IMAGE}"

# Deploy to Cloud Run (updates to latest image)
gcloud run services update "${SERVICE_NAME}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --project "${PROJECT_ID}"

echo "Deployed! URL:"
gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)"
