// TypeScript semantic extraction and an evidenced HTTP boundary to Python.
export interface Payload {
  value: number;
}

export class Client {
  public label(payload: Payload): string {
    return `ts:${payload.value}`;
  }
}

export function transform(value: number): number {
  return value + 1;
}

export async function score(payload: Payload): Promise<number> {
  const response = await fetch("http://python-api:8000/v1/score", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = (await response.json()) as { score: number };
  return transform(result.score);
}

export function unresolved(name: string): unknown {
  const candidate = (globalThis as Record<string, unknown>)[name];
  return typeof candidate === "function" ? candidate() : undefined;
}
