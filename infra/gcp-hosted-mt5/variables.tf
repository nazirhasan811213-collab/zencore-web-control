variable "project_id" {
  description = "Dedicated Google Cloud project for the ZenCore MT5 Demo cell."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid Google Cloud project ID."
  }
}

variable "region" {
  description = "Google Cloud region close to the broker."
  type        = string
  default     = "asia-southeast1"
}

variable "zone" {
  description = "Compute Engine zone for the first Demo cell."
  type        = string
  default     = "asia-southeast1-b"

  validation {
    condition     = startswith(var.zone, "${var.region}-")
    error_message = "zone must belong to region."
  }
}

variable "instance_name" {
  description = "Name of the single-account Windows MT5 Demo cell."
  type        = string
  default     = "zencore-mt5-demo-01"

  validation {
    condition     = can(regex("^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$", var.instance_name))
    error_message = "instance_name must be a valid Compute Engine name."
  }
}

variable "hosted_account_id" {
  description = "ZenCore hosted-account UUID assigned exclusively to this cell. Blank keeps leasing disabled."
  type        = string
  default     = ""

  validation {
    condition = var.hosted_account_id == "" || can(regex(
      "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
      var.hosted_account_id
    ))
    error_message = "hosted_account_id must be blank or a UUIDv4 from the ZenCore hosted-account state."
  }
}

variable "machine_type" {
  description = "Machine type for one MT5 terminal and the ZenCore worker."
  type        = string
  default     = "e2-standard-2"
}

variable "windows_image" {
  description = "Google-provided Windows Server image family."
  type        = string
  default     = "windows-cloud/windows-2022"
}

variable "boot_disk_size_gb" {
  description = "Shielded Windows boot disk size."
  type        = number
  default     = 60

  validation {
    condition     = var.boot_disk_size_gb >= 50 && var.boot_disk_size_gb <= 256
    error_message = "boot_disk_size_gb must be between 50 and 256."
  }
}

variable "control_plane_url" {
  description = "Public HTTPS origin of the ZenCore control plane."
  type        = string
  default     = "https://zencore-precision-entry.onrender.com"

  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(?::[0-9]+)?$", var.control_plane_url))
    error_message = "control_plane_url must be an HTTPS origin without a path."
  }
}

variable "key_alias" {
  description = "Short public alias stored in browser credential envelopes."
  type        = string
  default     = "zencore-gcp-hsm-demo-v1"

  validation {
    condition     = can(regex("^[A-Za-z0-9._:-]{3,80}$", var.key_alias))
    error_message = "key_alias must match the hosted envelope key ID format."
  }
}

variable "iap_admin_members" {
  description = "Temporary operators allowed to open an IAP tunnel, for example user:name@example.com."
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([
      for member in var.iap_admin_members :
      can(regex("^(user|group):[^[:space:]]+@[^[:space:]]+$", member))
    ])
    error_message = "Each IAP member must use user:email or group:email format."
  }
}

variable "broker_egress_cidrs" {
  description = "Broker endpoint ranges for the Demo validation cell. Narrow after discovery."
  type        = set(string)
  default     = ["0.0.0.0/0"]
}

variable "broker_egress_tcp_ports" {
  description = "Outbound broker and artifact ports. Port 443 is required initially."
  type        = set(string)
  default     = ["80", "443"]

  validation {
    condition = alltrue([
      for port in var.broker_egress_tcp_ports :
      can(regex("^[0-9]{1,5}(-[0-9]{1,5})?$", port))
    ])
    error_message = "broker_egress_tcp_ports entries must be ports or port ranges."
  }
}

variable "worker_release_url" {
  description = "Optional HTTPS URL of a reviewed hosted-worker ZIP. Blank keeps the cell staged."
  type        = string
  default     = ""

  validation {
    condition     = var.worker_release_url == "" || startswith(var.worker_release_url, "https://")
    error_message = "worker_release_url must be blank or HTTPS."
  }
}

variable "worker_release_sha256" {
  description = "Required SHA-256 when worker_release_url is set."
  type        = string
  default     = ""

  validation {
    condition = (
      var.worker_release_url == "" && var.worker_release_sha256 == ""
      ) || (
      var.worker_release_url != "" && can(regex("^[A-Fa-f0-9]{64}$", var.worker_release_sha256))
    )
    error_message = "A 64-character SHA-256 is required for a worker release URL."
  }
}

variable "mt5_installer_url" {
  description = "Optional broker MT5 installer URL. It is downloaded only after SHA verification."
  type        = string
  default     = ""

  validation {
    condition     = var.mt5_installer_url == "" || startswith(var.mt5_installer_url, "https://")
    error_message = "mt5_installer_url must be blank or HTTPS."
  }
}

variable "mt5_installer_sha256" {
  description = "Required SHA-256 when mt5_installer_url is set."
  type        = string
  default     = ""

  validation {
    condition = (
      var.mt5_installer_url == "" && var.mt5_installer_sha256 == ""
      ) || (
      var.mt5_installer_url != "" && can(regex("^[A-Fa-f0-9]{64}$", var.mt5_installer_sha256))
    )
    error_message = "A 64-character SHA-256 is required for an MT5 installer URL."
  }
}

variable "mt5_terminal_path" {
  description = "Expected terminal64.exe path after the reviewed InterStellar installer is run."
  type        = string
  default     = "C:\\Program Files\\MetaTrader 5\\terminal64.exe"

  validation {
    condition     = can(regex("^[A-Za-z]:\\\\[^\\r\\n]{3,240}$", var.mt5_terminal_path))
    error_message = "mt5_terminal_path must be an absolute Windows path."
  }
}

variable "allowed_demo_symbols" {
  description = "Broker-validated canonical symbols for this Demo cell."
  type        = set(string)
  default     = ["XAUUSD"]

  validation {
    condition = length(setsubtract(var.allowed_demo_symbols, toset([
      "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "USDCAD",
      "USDCHF", "EURJPY", "GBPJPY", "EURGBP", "BTCUSD"
    ]))) == 0 && length(var.allowed_demo_symbols) > 0
    error_message = "allowed_demo_symbols must contain only canonical ZenCore markets."
  }
}

variable "execution_enabled" {
  description = "Independent local rollout gate for the reviewed XAUUSD Demo execution worker. Keep false until the connection-only v2.1 heartbeat is certified."
  type        = bool
  default     = false
}
