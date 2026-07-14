# ADR-003: Keep session access behind the service

Status: accepted

The App Router handlers live in `app/api/session/route.ts`.
The `getSession` function is the supported read path.
The `DashboardPage` consumes the service through the barrel.

The identifier `GET` is intentionally generic.
`lib/cache.ts` intentionally does not resolve.
