terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
  }
}

provider "google" {
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
}

data "google_project" "target" {
  project_id = var.project_id
}

resource "google_project_service" "budgets_api" {
  project            = var.project_id
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

resource "google_billing_budget" "demo_cell" {
  billing_account = var.billing_account_id
  display_name    = "ZenCore MT5 Demo - ${var.project_id}"

  budget_filter {
    projects        = ["projects/${data.google_project.target.number}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      # Omit currency_code: Google uses the billing account's currency.
      units = tostring(var.monthly_budget_units)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.25, 0.5, 0.8, 1.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    enable_project_level_recipients = true
  }

  depends_on = [google_project_service.budgets_api]
}
