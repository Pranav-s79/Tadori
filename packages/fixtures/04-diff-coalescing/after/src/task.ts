import { Formatter } from "./formatter.js";
import { normalize } from "./helpers/helper.js";
import { Notifier } from "./notifier.js";
import { Resolver } from "./resolver.js";

export function processTask(
  input: string,
  notifier: Notifier,
  resolver: Resolver,
  formatter: Formatter
): string {
  notifier.send(input);
  const normalized = normalize(input);
  const formatted = formatter.renderValue(normalized);
  return resolver.resolve(formatted);
}
