---
name: tadori-spec-guardian
description: Use for Tadori architecture, scope, schema, relation, compatibility-fixture, or multi-language capability decisions. Do not use for unrelated general coding.
---

# Tadori specification guardian

The active authority is `docs/Specs/Tadori-Multilanguage-Transition.md`, the
machine-readable capability matrix, and the corresponding architecture audits.
The former v2.1 specification is historical only. Its TS/JS fixtures remain a
compatibility suite, not a product-scope limiter or authority over additive
multi-language contracts.

Keep one canonical graph, store, snapshot system, diff system, API model, and
visualization model. Prefer additive migrations and preserve legacy TS/JS
entity keys. New-language identity rules must prevent collisions and remain
deterministic. Never present parser-derived, convention-derived, inferred, or
unresolved relationships as compiler facts. Do not claim semantic parity where
only structural or repository support exists. Record meaningful capability and
status changes in `IMPLEMENTATION_STATUS.md`.
