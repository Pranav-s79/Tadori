export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

export function format(value: string): string;
export function format(value: number): string;
export function format(value: string | number): string {
  return String(value);
}
