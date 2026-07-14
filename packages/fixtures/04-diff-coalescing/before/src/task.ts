import { Audit } from "./audit.js";
import { Formatter } from "./formatter.js";
import { normalize } from "./legacy/helper.js";
import { Resolver } from "./resolver.js";

export function processTask(
  input: string,
  audit: Audit,
  resolver: any,
  formatter: Formatter
): string {
  audit.record(input);
  const normalized = normalize(input);
  const formatted = formatter.formatValue(normalized);
  return resolver.resolve(formatted);
}
