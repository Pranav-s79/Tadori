import { createSession, getSession } from "../../../lib/index.js";

export async function GET(): Promise<unknown> {
  return getSession("current");
}

export async function POST(): Promise<unknown> {
  return createSession("current");
}
