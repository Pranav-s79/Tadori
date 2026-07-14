export interface Strategy {
  run(input: number): number;
}

export class DoubleStrategy implements Strategy {
  run(input: number): number {
    return input * 2;
  }
}

export class TripleStrategy implements Strategy {
  run(input: number): number {
    return input * 3;
  }
}
