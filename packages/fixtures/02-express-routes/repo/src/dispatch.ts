import { makeUserController } from "./container.js";

export function dispatch(action: string): unknown {
  const controller = makeUserController();
  return (controller as unknown as Record<string, () => unknown>)[action]();
}
