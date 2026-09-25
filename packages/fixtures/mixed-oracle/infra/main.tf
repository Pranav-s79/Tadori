terraform {
  required_version = ">= 1.9.0"
}

# Terraform configuration evidence for the service boundary.
variable "python_base_url" {
  type    = string
  default = "http://python-api:8000"
}

output "score_url" {
  value = "${var.python_base_url}/v1/score"
}
