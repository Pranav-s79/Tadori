// JavaScript remains on the semantic TS/JS adapter.
export class Payload {
  constructor(value) { this.value = value; }
  label() { return `js:${this.value}`; }
}

export function transform(value) {
  return value + 1;
}

export function unresolved(name) {
  const candidate = globalThis[name];
  return typeof candidate === "function" ? candidate() : undefined;
}
