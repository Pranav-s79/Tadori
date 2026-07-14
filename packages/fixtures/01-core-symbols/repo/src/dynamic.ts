import { handlers } from "./handlers.js";

export function dispatch(key: string): string {
  return handlers[key as keyof typeof handlers]();
}
