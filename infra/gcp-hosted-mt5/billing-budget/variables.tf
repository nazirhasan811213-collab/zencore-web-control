variable "project_id" {
  description = "Dedicated Google Cloud project to monitor."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid Google Cloud project ID."
  }
}

variable "billing_account_id" {
  description = "Billing Account ID linked to the project, such as XXXXXX-XXXXXX-XXXXXX; not a payment card number."
  type        = string

  validation {
    condition     = can(regex("^[A-Fa-f0-9]{6}-[A-Fa-f0-9]{6}-[A-Fa-f0-9]{6}$", var.billing_account_id))
    error_message = "billing_account_id must be the 6-6-6 Billing Account ID without a billingAccounts/ prefix."
  }
}

variable "monthly_budget_units" {
  description = "Required monthly alert target in whole units of the verified billing account currency; alerts do not cap spending."
  type        = number

  validation {
    condition     = var.monthly_budget_units >= 1 && var.monthly_budget_units == floor(var.monthly_budget_units)
    error_message = "monthly_budget_units must be a positive whole number."
  }
}
