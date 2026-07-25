import { Payload, transform, unresolved } from "./worker.js";

// Test calls exercise class, method, function, and unresolved linkage.
new Payload(transform(1)).label();
unresolved("missingWorker");
