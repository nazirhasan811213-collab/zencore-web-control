output "worker_instance" {
  description = "Shielded Windows Demo cell name."
  value       = google_compute_instance.worker.name
}

output "worker_internal_ip" {
  description = "Private address only; no public IP is attached."
  value       = google_compute_instance.worker.network_interface[0].network_ip
}

output "worker_service_account" {
  description = "Keyless identity allowed to call asymmetricDecrypt on one HSM key."
  value       = google_service_account.worker.email
}

output "render_worker_identity_environment" {
  description = "Non-secret exact identity pins for Render. Keep the worker gate false until preflight passes."
  value = {
    ZENCORE_GCP_WORKER_AUDIENCE        = "${var.control_plane_url}/api/hosted-execution"
    ZENCORE_GCP_WORKER_PROJECT_ID      = var.project_id
    ZENCORE_GCP_WORKER_ZONE            = var.zone
    ZENCORE_GCP_WORKER_INSTANCE        = google_compute_instance.worker.name
    ZENCORE_GCP_WORKER_SERVICE_ACCOUNT = google_service_account.worker.email
    ZENCORE_GCP_WORKER_HOSTED_ACCOUNT_ID = var.hosted_account_id
  }
}

output "credential_key_alias" {
  description = "Set as ZENCORE_MT5_CREDENTIAL_KEY_ID only after Demo preflight passes."
  value       = var.key_alias
}

output "credential_key_version_resource" {
  description = "Pinned KMS key version used by the first worker release."
  value       = "${google_kms_crypto_key.credential_envelope.id}/cryptoKeyVersions/1"
}

output "public_key_export_command" {
  description = "Exports only the public key; Cloud KMS never exposes the private key."
  value = join(" ", [
    "gcloud kms keys versions get-public-key 1",
    "--project=${var.project_id}",
    "--location=${var.region}",
    "--keyring=${google_kms_key_ring.worker.name}",
    "--key=${google_kms_crypto_key.credential_envelope.name}",
    "--output-file=zencore-mt5-public-key.pem",
  ])
}

output "iap_rdp_tunnel_command" {
  description = "Temporary administrative tunnel; remove IAP membership after image validation."
  value = join(" ", [
    "gcloud compute start-iap-tunnel ${google_compute_instance.worker.name} 3389",
    "--project=${var.project_id}",
    "--zone=${var.zone}",
    "--local-host-port=localhost:13389",
  ])
}

output "execution_state" {
  value = {
    demo_only         = true
    execution_enabled = var.execution_enabled
    hosted_web_gate   = "KEEP_FALSE_UNTIL_DEMO_CERTIFIED"
  }
}
