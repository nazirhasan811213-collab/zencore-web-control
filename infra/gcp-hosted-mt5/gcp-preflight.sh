#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-zencore-total-trade-system}"

REQUIRED_SERVICES=(
  serviceusage.googleapis.com
  cloudresourcemanager.googleapis.com
  cloudbilling.googleapis.com
  billingbudgets.googleapis.com
  iam.googleapis.com
  compute.googleapis.com
  cloudkms.googleapis.com
  iap.googleapis.com
  logging.googleapis.com
  monitoring.googleapis.com
  osconfig.googleapis.com
)

echo "== ZenCore GCP preflight =="
echo "Project: ${PROJECT_ID}"
echo

gcloud config set project "${PROJECT_ID}" >/dev/null

echo "-- Active Google account --"
gcloud auth list --filter=status:ACTIVE --format="value(account)"
echo

echo "-- Project --"
gcloud projects describe "${PROJECT_ID}" --format="table(projectId,projectNumber,name,lifecycleState)"
echo

echo "-- Billing --"
gcloud beta billing projects describe "${PROJECT_ID}"   --format="table(projectId,billingEnabled,billingAccountName)"
echo

echo "-- Enabling required APIs (no VM/HSM is created by this script) --"
gcloud services enable "${REQUIRED_SERVICES[@]}" --project="${PROJECT_ID}"
echo

echo "-- Required API status --"
for service in "${REQUIRED_SERVICES[@]}"; do
  if gcloud services list --enabled --project="${PROJECT_ID}"       --filter="config.name=${service}" --format="value(config.name)" | grep -qx "${service}"; then
    printf "OK   %s\n" "${service}"
  else
    printf "MISS %s\n" "${service}"
    exit 1
  fi
done

echo
echo "PRECHECK_OK"
echo "No Compute Engine VM, Cloud NAT, Persistent Disk, or Cloud HSM key was created."
echo "Next gate: create/review the project budget, then run Terraform plan before any apply."
