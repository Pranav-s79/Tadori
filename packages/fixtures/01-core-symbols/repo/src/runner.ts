import type { Strategy } from "./strategy.js";

export class Runner {
  constructor(private readonly strategy: Strategy) {}

  execute(value: number): number {
    return this.strategy.run(value);
  }
}
