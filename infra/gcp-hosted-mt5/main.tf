locals {
  required_services = toset([
    "cloudkms.googleapis.com",
    "compute.googleapis.com",
    "iap.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "osconfig.googleapis.com",
  ])

  common_labels = {
    application = "zencore"
    component   = "hosted-mt5"
    environment = "demo"
    execution   = var.execution_enabled ? "demo-enabled" : "locked"
  }

  worker_config = {
    schemaVersion            = 1
    cellId                   = var.instance_name
    provider                 = "GOOGLE_CLOUD"
    controlPlaneUrl          = var.control_plane_url
    controlPlaneAudience     = "${var.control_plane_url}/api/hosted-execution"
    hostedAccountId          = var.hosted_account_id
    keyAlias                 = var.key_alias
    keyVersionResource       = "${google_kms_crypto_key.credential_envelope.id}/cryptoKeyVersions/1"
    demoOnly                 = true
    executionEnabled         = var.execution_enabled
    allowedDemoSymbols       = sort(tolist(var.allowed_demo_symbols))
    credentialStorage        = "MEMORY_ONLY"
    privateKeyAvailable      = false
    mt5TerminalPath          = var.mt5_terminal_path
    approvedDemoServer       = "InterStellarFinancial-Demo"
    heartbeatIntervalSeconds = 10
    connectorVersion         = var.execution_enabled ? "2.2.1-gcp-multiuser-multipair" : "2.0.0-gcp-connect"
  }
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_compute_network" "worker" {
  name                    = "zencore-mt5-private"
  auto_create_subnetworks = false

  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "worker" {
  name                     = "zencore-mt5-${var.region}"
  region                   = var.region
  network                  = google_compute_network.worker.id
  ip_cidr_range            = "10.91.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_router" "worker" {
  name    = "zencore-mt5-router"
  region  = var.region
  network = google_compute_network.worker.id
}

resource "google_compute_router_nat" "worker" {
  name                               = "zencore-mt5-nat"
  router                             = google_compute_router.worker.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.worker.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_service_account" "worker" {
  account_id   = "zencore-mt5-demo-worker"
  display_name = "ZenCore MT5 Demo worker"
  description  = "Keyless workload identity for one staged MT5 Demo cell."

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "worker_observability" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_kms_key_ring" "worker" {
  name     = "zencore-mt5"
  location = var.region

  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key" "credential_envelope" {
  name     = "credential-envelope"
  key_ring = google_kms_key_ring.worker.id
  purpose  = "ASYMMETRIC_DECRYPT"

  version_template {
    algorithm        = "RSA_DECRYPT_OAEP_3072_SHA256"
    protection_level = "HSM"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "worker_decrypt" {
  crypto_key_id = google_kms_crypto_key.credential_envelope.id
  role          = "roles/cloudkms.cryptoKeyDecrypter"
  member        = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "iap_tunnel" {
  for_each = var.iap_admin_members

  project = var.project_id
  role    = "roles/iap.tunnelResourceAccessor"
  member  = each.value
}

resource "google_compute_firewall" "iap_rdp" {
  name      = "zencore-mt5-iap-rdp"
  network   = google_compute_network.worker.name
  direction = "INGRESS"
  priority  = 900

  source_ranges           = ["35.235.240.0/20"]
  target_service_accounts = [google_service_account.worker.email]

  allow {
    protocol = "tcp"
    ports    = ["3389"]
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_firewall" "metadata_egress" {
  name      = "zencore-mt5-metadata-egress"
  network   = google_compute_network.worker.name
  direction = "EGRESS"
  priority  = 800

  destination_ranges      = ["169.254.169.254/32"]
  target_service_accounts = [google_service_account.worker.email]

  allow {
    protocol = "tcp"
    ports    = ["53", "80"]
  }

  allow {
    protocol = "udp"
    ports    = ["53", "123"]
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_route" "windows_activation" {
  name             = "zencore-mt5-windows-kms"
  network          = google_compute_network.worker.name
  dest_range       = "35.190.247.13/32"
  next_hop_gateway = "default-internet-gateway"
  priority         = 100
}

resource "google_compute_firewall" "windows_activation_egress" {
  name      = "zencore-mt5-windows-kms-egress"
  network   = google_compute_network.worker.name
  direction = "EGRESS"
  priority  = 850

  destination_ranges      = ["35.190.247.13/32"]
  target_service_accounts = [google_service_account.worker.email]

  allow {
    protocol = "tcp"
    ports    = ["1688"]
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_firewall" "approved_egress" {
  name      = "zencore-mt5-approved-egress"
  network   = google_compute_network.worker.name
  direction = "EGRESS"
  priority  = 900

  destination_ranges      = var.broker_egress_cidrs
  target_service_accounts = [google_service_account.worker.email]

  allow {
    protocol = "tcp"
    ports    = sort(tolist(var.broker_egress_tcp_ports))
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_firewall" "deny_other_egress" {
  name      = "zencore-mt5-deny-other-egress"
  network   = google_compute_network.worker.name
  direction = "EGRESS"
  priority  = 65534

  destination_ranges      = ["0.0.0.0/0"]
  target_service_accounts = [google_service_account.worker.email]

  deny {
    protocol = "all"
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_instance" "worker" {
  name                      = var.instance_name
  zone                      = var.zone
  machine_type              = var.machine_type
  deletion_protection       = true
  allow_stopping_for_update = true
  can_ip_forward            = false
  labels                    = local.common_labels

  boot_disk {
    auto_delete = false

    initialize_params {
      image = var.windows_image
      size  = var.boot_disk_size_gb
      type  = "pd-balanced"
      labels = {
        data_classification = "no-plaintext-credentials"
      }
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.worker.id
    # Deliberately no access_config: the VM has no public IP.
  }

  service_account {
    email  = google_service_account.worker.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  scheduling {
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
    preemptible         = false
  }

  metadata = {
    enable-osconfig          = "TRUE"
    disable-legacy-endpoints = "TRUE"
    windows-startup-script-ps1 = templatefile(
      "${path.module}/bootstrap/Install-ZenCoreGcpHostedWorker.ps1.tftpl",
      {
        worker_config_base64 = base64encode(jsonencode(local.worker_config))
        worker_release_url   = var.worker_release_url
        worker_release_sha   = lower(var.worker_release_sha256)
        mt5_installer_url    = var.mt5_installer_url
        mt5_installer_sha    = lower(var.mt5_installer_sha256)
      }
    )
  }

  depends_on = [
    google_compute_router_nat.worker,
    google_compute_firewall.deny_other_egress,
    google_kms_crypto_key_iam_member.worker_decrypt,
    google_project_iam_member.worker_observability,
  ]

  lifecycle {
    prevent_destroy = true
  }
}
