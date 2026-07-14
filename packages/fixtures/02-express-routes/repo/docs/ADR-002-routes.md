# ADR-002: Keep HTTP routing thin

Status: accepted

The literal route is declared in `src/routes/users.ts`.
The `UserController` owns response mapping.
The `createAdmin` handler is registered through a computed path.

`src/routes/missing.ts` intentionally does not resolve.
The name `controller` is intentionally too generic to link.
