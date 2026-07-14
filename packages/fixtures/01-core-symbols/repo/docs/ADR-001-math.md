# ADR-001: Keep recursive math helpers pure

Status: accepted

The implementation is in `src/math.ts`.
The `factorial` function remains recursive so it is easy to inspect.
The `Runner` class depends on the `Strategy` abstraction.

The word `run` is intentionally ambiguous because several methods use it.
`src/missing.ts` intentionally does not resolve.
