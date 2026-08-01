# Known failures (parked)

Failures that are isolated, reproducible, and deliberately not being worked on
right now. Nothing here is weakened, skipped, or deleted — each entry names the
gate that still fails and the evidence gathered so far, so work can resume
without repeating the investigation.

---

## KF-001 — Installed-GUI smoke: keyboard descent on Ubuntu + headless Firefox

**Status:** parked 2026-07-31. Blocks PR #53 merge (1 of 5 CI jobs).
**Gate:** `pnpm package:smoke` with `TADORI_PACKAGE_BROWSER=firefox`, run only on
the canonical `ubuntu-latest / Node 22.14.0` leg.
**Not weakened:** the assertion still fails the build. No skip, no narrowing.

### Symptom

```
AssertionError: firefox keyboard descent expanded no node from the installed
artifact (still 4 of 4)
```

The other four matrix jobs (ubuntu 24, ubuntu 26, windows 22, macos 22) pass.
The same smoke passes locally on Windows + headless Firefox (4 -> 5 nodes), so
the development machine cannot reproduce it.

### Evidence

From CI run `30610139860`, job `91090880480`:

```
focus report:  {"activeElement":"","documentHasFocus":true,"canvasTabIndex":0}
focus state:   {"focusedNode":null,"activeElement":"","canvasCount":40}
per-key:       [{"after":"ArrowRight","keysSeen":[],"focusedNode":null,"showing":4},
                {"after":"Enter",     "keysSeen":[],"focusedNode":null,"showing":4}, ...]
failed requests: (none)
browser errors:  (none)
```

`keysSeen` comes from a capture-phase listener the test attaches to the same
element the application binds its handler to. It fires before application code
and cannot be suppressed by it.

### What is established

- The renderer is healthy: 40-41 canvases, zero browser errors, zero failed
  requests. **This is not a rendering or WebGL failure.**
- The document has focus (`documentHasFocus: true`), so the browsing context is
  not the problem.
- The canvas is present, visible, and focusable by configuration
  (`tabIndex: 0`).
- `element.focus()` runs without error yet `activeElement` stays `<body>`.
- No keydown reaches the element for any of the eight presses, via either
  `page.keyboard.press()` or `locator.press()`.
- Therefore `PackageMapCanvas` is **not implicated** — its handler is never
  given an event to act on.

### Classification

**Branch 2: the element is reachable and correctly configured, but the keydown
handler receives nothing.** Focus assignment silently fails, and key delivery is
downstream of it.

### Hypotheses already disproved

| Hypothesis | Disproved by |
|---|---|
| Headless Firefox lacks WebGL, app falls back to Table | 40+ canvases, zero errors |
| Alphabetically-first node is not descendable | all four nodes tried, none descended |
| `locator.press()` would deliver where `focus()` could not | `keysSeen: []` for every press |
| Browsing context is unfocused (`bringToFront` fixes it) | `documentHasFocus: true` |

### Next step when resumed

An instrumentation-only probe now lives in `scripts/smoke-package.mjs` and
prints as `delivery report:` beside the existing evidence when the assertion
fails. It changes no application code and weakens no assertion; it distinguishes
the remaining causes in one CI run, whose output is what this entry is waiting
on. What it measures:

1. **Can anything focus?** Append a `<button>`, `focus()` it, compare
   `document.activeElement`, remove it. Separates "this element is unfocusable"
   from "focus is broken page-wide".
2. **Ancestor chain audit.** Walk canvas -> root recording `inert`, `hidden`,
   `aria-hidden`, computed `display`/`visibility`, plus the canvas bounding rect.
   (The only `inert` in `App.tsx` is on the navigation drawer, which is not an
   ancestor of the canvas.)
3. **Dispatch vs injection.** `element.dispatchEvent(new KeyboardEvent(...))`
   and check whether the capture listener fires. If dispatch reaches the
   listener but `locator.press()` does not, the failure is in Playwright's
   injection path rather than DOM wiring.

If it turns out the environment genuinely cannot deliver a real key event, the
proposed resolution — **requiring approval before implementation** — is to split
the coverage rather than drop it: keep keyboard behaviour asserted by a focused
component/browser test, retain the remaining installed-package GUI checks
(title, mode tabs, node count, Table parity, inspection), and report the
Firefox/Linux limitation explicitly instead of skipping it silently.

### New evidence (2026-07-31): a hidden canvas cannot take focus

Overview became the landing mode, which puts the Atlas workspace — and the
canvas inside it — behind `hidden`. Playwright reports this directly when the
smoke runs against the installed artifact:

```
locator resolved to hidden <div tabindex="0" role="application"
  class="package-map-canvas" aria-label="Package map; arrows move focus…">
```

An element inside a `hidden` subtree is in the DOM, keeps `tabIndex 0`, and is
counted by `querySelectorAll` — but it cannot take focus. `element.focus()`
succeeds silently, `document.activeElement` stays on `<body>`, and no keydown
is ever delivered, while the renderer looks entirely healthy.

**That signature is identical to KF-001's.** Both gates now enter Atlas before
touching the canvas, and the smoke passes locally under chromium and firefox
(4 -> 5 nodes).

**This does not retroactively explain KF-001.** The failure was recorded at
`254af7c`, where Atlas was still the landing mode and the canvas was not
hidden, so the mechanism above did not exist on that tree. Two possibilities
remain open and are not being guessed between:

1. The original failure has a different cause and will reappear now that the
   gate can reach the keyboard step again.
2. Something else placed the canvas in a non-focusable state on that leg — for
   example `onRendererError` switching to Table mode, which hides the same
   subtree — in which case the mechanism is shared and the trigger differs.

The probe is unchanged and still reports focusability, the ancestor chain, and
synthetic-dispatch delivery. The next matrix run at a green lint step is the
first real signal since this entry was opened.

### Cost note

Four speculative fixes were pushed before instrumentation produced a decisive
answer. The lesson recorded for next time: on an environment-specific failure
the development machine cannot reproduce, add the probe **first**. Guessing
across CI cycles is the expensive path.
