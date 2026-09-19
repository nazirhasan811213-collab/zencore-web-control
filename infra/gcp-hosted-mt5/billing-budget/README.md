# ZenCore MT5 Demo: project budget alert

This independent Terraform root only enables the Billing Budgets API and creates a **monthly alerts-only** budget for `zencore-total-trade-system`. It does not create the MT5 VM, disk, NAT, or HSM key. Budget thresholds are 25%, 50%, 80%, and 100% of current spend, plus 100% of forecasted spend. Default recipients are billing account administrators/users and the project's Owners.

An alert **does not cap spending**. There is deliberately no default budget amount: choose the target in the **billing account's currency** after reviewing the pricing estimate. The example value of zero deliberately fails validation until it is replaced. There is no billing account ID or payment information in this repository.

## Prepare the read-only plan

1. Confirm that `zencore-total-trade-system` is linked to your billing account. Copy its **Billing Account ID** (format `XXXXXX-XXXXXX-XXXXXX`), not any card or password.
2. Authenticate the Google Cloud CLI on a trusted operator machine: `gcloud auth application-default login`. Your identity needs project read, `serviceusage.services.use`, permission to enable `billingbudgets.googleapis.com`, and permission to create a budget for the linked billing account. Do not send credentials, access tokens, or payment details into chat or Terraform variables.
3. Copy `terraform.tfvars.example` to ignored `terraform.tfvars`, set the real billing account ID, and replace the example `monthly_budget_units` with the reviewed amount. Verify the amount against the billing account currency.
4. In this directory run:

```text
terraform init
terraform fmt -check
terraform validate
terraform plan -input=false -out zencore-budget.tfplan
terraform show zencore-budget.tfplan
```

Review the plan before applying the budget alert. `terraform apply zencore-budget.tfplan` creates the alert and enables the Billing Budgets API; it does not deploy the Windows cell. Confirm alerts appear under Billing > Budgets & alerts before creating any billable MT5 infrastructure. If an alert for this project already exists, inspect it before creating another.

Terraform state and plan files can contain sensitive values; this repository ignores them. Store state securely if this becomes a shared project.
