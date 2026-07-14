import { findSession, insertSession } from "./db.js";

export function getSession(id: string): { id: string; user: string } {
  return findSession(id);
}

export function createSession(id: string): { id: string; user: string } {
  return insertSession(id);
}
