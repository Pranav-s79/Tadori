import { factorial as sequence } from "./math.js";

export function useAlias(value: number): number {
  return sequence(value);
}
