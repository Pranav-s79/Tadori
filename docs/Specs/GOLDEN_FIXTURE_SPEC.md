# Tadori Golden Fixture Specification

**Status:** Legacy TS/JS compatibility suite; not a product-scope contract
**Target package:** `packages/fixtures`  
**Ground-truth format:** JSON Schema draft 2020-12  
**Fixture size constraint:** Every source repository contains fewer than 30 files.

## 1. Contract

The fixture package contains three known-complete single-snapshot TypeScript repositories and one before/after micro-fixture. It protects backward compatibility while separate mixed-language oracles define current capability.

The indexer test harness MUST:

1. index only the `indexedFiles` named in each expected graph;
2. allow `supportFiles` to participate in TypeScript resolution without requiring graph nodes;
3. canonicalize node and edge identities using the frozen printable pipe-delimited rules;
4. compare graph nodes by `entityKey`;
5. compare graph edges by `entityKey`;
6. compare `origin`, `confidence`, and `resolution` exactly;
7. compare expected evidence by repository-relative file, one-based line, and required substring;
8. fail on unexpected nodes or edges unless the item is explicitly excluded by the fixture contract;
9. verify every edge endpoint exists in the same expected graph;
10. separately compare seeded boundary violations and explicitly excluded candidates.

Array order is not semantic. Harnesses should sort:

- nodes by `entityKey`;
- edges by `entityKey`;
- evidence by `(file, line, contains)`;
- boundary violations by `(ruleId, src, dst)`.

Local `id` values are readable fixture aliases. They are not stable repository identities.

## 2. Node extraction contract

The fixtures expect these v1 node kinds only:

`package`, `file`, `function`, `method`, `class`, `interface`, `route`, `test`, `adr`, `external_dep`, and `unresolved`.

The schemas permit the full frozen v2.1 enum, but these fixtures do not add new relations or product scope.

Deliberate contract decisions:

- package manifests, `tsconfig.json`, and `tadori.rules.json` are support/configuration files rather than graph file nodes;
- `.d.ts` shims may participate in compiler resolution without becoming expected file nodes;
- variable declarations are not nodes;
- constructors are not nodes and constructor invocations do not emit `calls` edges;
- function-valued class properties used as handlers are `method` nodes;
- overload declarations collapse to one logical function node;
- call callee identifiers do not also emit duplicate `references` edges;
- built-in functions such as `String` are excluded;
- direct exports emit `file -> symbol` `exports` edges;
- barrel re-exports emit `barrel file -> target symbol` `exports` edges;
- test linkage is static evidence only and never claims runtime coverage;
- middleware mounts such as `app.use()` are not HTTP route nodes in v1.

## 3. Expected-graph JSON

Schema: `schemas/expected-graph.schema.json`

Each graph contains:

- fixture metadata and supported relation strata;
- the complete expected node list;
- the complete expected edge list;
- provenance, confidence, and resolution for every edge;
- exact evidence anchors;
- expected boundary violations;
- deliberately excluded candidates and the reason each must not appear.

A node identity is:

```text
node|<escaped kind>|<escaped qualified name>
```

An edge identity is:

```text
edge|<escaped source entity key>|<escaped relation>|<escaped destination entity key>
```

Backslashes and pipes are escaped before UTF-8 SHA-256 hashing.

## 4. Fixture 01 — Core symbols

**Purpose:** Exercise the foundational TypeScript graph without framework-specific routing.

**Expected graph:** `packages/fixtures/01-core-symbols/expected/graph.json`  
**Expected nodes:** 32  
**Expected edges:** 72

**Relation strata:** contains, imports, exports, references, calls, implements, tests, documents.

**Deliberately nasty cases:**

- `factorial as sequence` aliased import;
- barrel imports and re-exports through `src/index.ts`;
- three `format` overload declarations collapsing to one node;
- recursive `factorial` self-call;
- `Runner` resolving through the injected `Strategy` interface rather than concrete implementations;
- `handlers[key]()` producing an unresolved synthetic call target;
- statically linked tests plus a misleading `mathy.test.ts`;
- ADR exact path, unique symbols, ambiguous `run`, and missing path;
- one seeded public-to-internal boundary violation.

Recursive rename limitation: a recursive function whose body contains a self-reference will not Stage-B match after rename because the body text and hash change with the symbol name. Falling back to the raw added/removed diff is expected behavior.

### Full file tree

```text
├── docs
│   └── ADR-001-math.md
├── package.json
├── src
│   ├── alias-consumer.ts
│   ├── dynamic.ts
│   ├── handlers.ts
│   ├── index.ts
│   ├── internal
│   │   └── secret.ts
│   ├── math.ts
│   ├── public
│   │   └── report.ts
│   ├── runner.ts
│   └── strategy.ts
├── tadori.rules.json
├── tests
│   ├── math.test.ts
│   └── mathy.test.ts
└── tsconfig.json
```

## 5. Fixture 02 — Express routes

**Purpose:** Exercise Express route extraction and controller/service graph behavior.

**Expected graph:** `packages/fixtures/02-express-routes/expected/graph.json`  
**Expected nodes:** 33  
**Expected edges:** 79

**Relation strata:** contains, imports, exports, references, calls, tests, routes_to, documents.

**Deliberately nasty cases:**

- literal `GET /users/:id`;
- computed `POST adminPath`;
- function-valued controller properties;
- constructor-based DI;
- dynamic `controller[action]()` unresolved call;
- static test property reference and misleading admin test;
- ADR exact path, unique symbols, generic ambiguous name, and missing path;
- one seeded controllers-to-infrastructure boundary violation.

The literal route is `compiler/certain/resolved`. The computed identifier route is intentionally `heuristic/likely/partial`.

### Full file tree

```text
├── docs
│   └── ADR-002-routes.md
├── package.json
├── src
│   ├── app.ts
│   ├── container.ts
│   ├── controllers
│   │   ├── admin-controller.ts
│   │   └── user-controller.ts
│   ├── dispatch.ts
│   ├── infra
│   │   └── db.ts
│   ├── routes
│   │   ├── admin.ts
│   │   └── users.ts
│   └── services
│       ├── audit-service.ts
│       └── user-service.ts
├── tadori.rules.json
├── tests
│   ├── adminish.test.ts
│   └── user-controller.test.ts
├── tsconfig.json
└── types
    └── express.d.ts
```

## 6. Fixture 03 — Next routes

**Purpose:** Exercise Next.js App Router and Pages Router conventions.

**Expected graph:** `packages/fixtures/03-next-routes/expected/graph.json`  
**Expected nodes:** 30  
**Expected edges:** 68

**Relation strata:** contains, imports, exports, calls, tests, routes_to, documents.

**Deliberately nasty cases:**

- App Router `route.ts` with separate GET and POST route nodes;
- App Router `page.tsx`;
- Pages Router API default handler;
- Pages Router page default export;
- barrel exports through `lib/index.ts`;
- static service test and misleading page test;
- ADR exact route file, unique symbols, generic `GET`, and missing cache path.

### Full file tree

```text
├── app
│   ├── api
│   │   └── session
│   │       └── route.ts
│   └── dashboard
│       └── page.tsx
├── components
│   └── user-card.tsx
├── docs
│   └── ADR-003-session.md
├── lib
│   ├── db.ts
│   ├── index.ts
│   └── session-service.ts
├── package.json
├── pages
│   ├── api
│   │   └── legacy.ts
│   └── profile.tsx
├── tests
│   ├── session-page.test.ts
│   └── session-service.test.ts
└── tsconfig.json
```

## 7. Fixture 04 — Diff coalescing

**Purpose:** Verify raw snapshot set differences and the presentation-time move/rename coalescing pass.

Expected artifacts:

- `expected/before-graph.json`
- `expected/after-graph.json`
- `expected/raw-diff.json`
- `expected/coalesced-diff.json`

Required semantic assertions:

1. `src/legacy/helper.ts` moves to `src/helpers/helper.ts`;
2. `Formatter.formatValue` renames to `Formatter.renderValue`;
3. `processTask -> Notifier.send` is a genuine call addition;
4. `processTask -> Audit.record` is a genuine call removal;
5. `processTask -> Resolver.resolve` upgrades from `heuristic/likely/partial` to `compiler/certain/resolved`.

The raw diff preserves identity churn. The coalesced diff pairs:

- three node pairs;
- eight affected edge pairs;
- no ambiguous candidate groups.

It retains four residual added edges, three residual removed edges, and one resolution/provenance change.

### Before tree

```text
├── package.json
├── src
│   ├── audit.ts
│   ├── formatter.ts
│   ├── legacy
│   │   └── helper.ts
│   ├── notifier.ts
│   ├── resolver.ts
│   └── task.ts
└── tsconfig.json
```

### After tree

```text
├── package.json
├── src
│   ├── audit.ts
│   ├── formatter.ts
│   ├── helpers
│   │   └── helper.ts
│   ├── notifier.ts
│   ├── resolver.ts
│   └── task.ts
└── tsconfig.json
```

## 8. Coverage matrix

| Required case | Core | Express | Next | Diff |
|---|:---:|:---:|:---:|:---:|
| Aliased imports | ✓ |  |  |  |
| Re-exports and barrels | ✓ |  | ✓ |  |
| Dynamic `obj[k]()` | ✓ | ✓ |  |  |
| DI-style injection | ✓ | ✓ |  |  |
| Overloads | ✓ |  |  |  |
| Recursive function | ✓ |  |  |  |
| Express literal route |  | ✓ |  |  |
| Express computed route |  | ✓ |  |  |
| Next App Router |  |  | ✓ |  |
| Next Pages Router |  |  | ✓ |  |
| Static test linkage | ✓ | ✓ | ✓ |  |
| Test with no static linkage | ✓ | ✓ | ✓ |  |
| Ambiguous test name | ✓ | ✓ | ✓ |  |
| ADR resolving links | ✓ | ✓ | ✓ |  |
| ADR non-resolving links | ✓ | ✓ | ✓ |  |
| Seeded boundary violation | ✓ | ✓ |  |  |
| File move |  |  |  | ✓ |
| Symbol rename |  |  |  | ✓ |
| Genuine edge addition/removal |  |  |  | ✓ |
| Resolution upgrade |  |  |  | ✓ |

## 9. Harness assertions

For each single-snapshot fixture:

```text
actual node keys == expected node keys
actual edge keys == expected edge keys
actual edge metadata == expected edge metadata
dangling endpoint count == 0
actual seeded boundary violations == expected violations
excluded candidates do not appear
```

For the diff fixture:

```text
before graph == expected before graph
after graph == expected after graph
raw diff == expected raw diff
coalesced diff == expected coalesced diff
raw identities remain unchanged by coalescing
```

The expected JSON files are the normative ground truth. This Markdown document explains the contract but does not override machine-readable expectations.
