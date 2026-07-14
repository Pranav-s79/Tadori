import { getSession } from "../../lib/index.js";

export default function legacyHandler(): unknown {
  return getSession("legacy");
}
