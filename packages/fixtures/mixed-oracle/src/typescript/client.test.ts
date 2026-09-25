import { Client, score, transform } from "./client.js";

// Static test linkage is not runtime coverage.
void new Client().label({ value: transform(1) });
void score({ value: 2 });
