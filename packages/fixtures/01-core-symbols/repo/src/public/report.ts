import { readSecret } from "../internal/secret.js";

export function buildReport(): string {
  return readSecret();
}
