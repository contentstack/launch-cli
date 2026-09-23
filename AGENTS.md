## Testing instructions

- Follow the Arrange, Act, Assert structure when writing unit tests.
- When writing unit tests, create individual unit tests that cover each logical branching in the code.
- For the happy path, can we have a single unit test where all the top level if conditions are executed? This might help with reducing the number of total unit tests created and still give same test coverage.
- For the tests for edge cases do not create separate describe blocks, keep the hierarchy flat.
- For the tests for edge cases, do not skip assertions, its still worth adding all assertions similar to the happy paths tests.
- Use only jest for writing test cases and refer existing unit test under the /src folder.
- Do not create code comments for any changes.

**Integration tests.** `test/integration/` drives real code with only the network faked by `nock`.
`projects-list-command.test.ts` runs whole commands through `@oclif/test`'s `runCommand`, which
covers `init()`, the resolution chain, rendering and the `catch()` exit-code mapping in one pass.
Two things make that reliable and both are load-bearing:

- The `Config` is built from a root `Plugin` constructed with `ignoreManifest: true`. Without it, a
  generated `oclif.manifest.json` — `npm run prepack` writes one, and it is gitignored — makes oclif
  load the compiled `dist/commands` instead of `src`, so the suite would test stale compiled output
  and fail outright whenever `dist` is absent.
- `console.log` is redirected straight to `process.stdout` so jest's console decoration stays out of
  the captured stdout, and `process.exitCode` is reset after each run because oclif sets it while
  handling a simulated CLI failure and would otherwise fail the whole jest run.

The confirm gate is the one part of `LaunchCommand` `runCommand` cannot reach yet: no shipped
command declares `yes: {}`. It stays covered by `src/base/launch-command.test.ts` until one does.

## Adding a command (V2)

Five touch points, in this order:

1. **`src/flags/catalog.ts`** — only if the command introduces a flag no command uses yet.
   Transcribe it from the Commands Details page §"All flags" tables. Never set `required: true`.
   Catalog flag definition objects are shared by reference across every command that uses them —
   never mutate one in place.
2. **`src/flags/resolution.ts`** — one entry per new flag, saying where its value may come from:
   `configPath`, `prompt`, `default`. `resolution` is typed `Record<FlagKey, ResolutionSpec>`, so a
   catalog key added without a matching resolution entry is a **compile error**, not something a
   test has to catch.
3. **`src/api/<resource>.ts`** — only if the command calls an endpoint no command calls yet.
   These modules take a `RestApiClient` and return typed data. No `ux`, no prompts, no `process.exit`.
4. **`src/api/index.ts`** — a new resource module must be registered here: a field on `ApiSurface`
   and its construction in `buildApi`. This is the one shared file every resource module edits,
   so expect to rebase on it.
5. **`src/commands/launch/<resource>/<verb>.ts`** — the command itself: a `static inputs`
   declaration, `static flags = flagsFor(...)`, and a `run()` that calls the api and renders. The
   command's `flags` keys must equal its `inputs` keys — both shipped commands assert this by
   deriving `flags` from `inputs` via `flagsFor`, rather than declaring the two independently.

A command that declares `--project` in `inputs` must also declare `--org`: `resolution.project.normalize`
reads `resolved.org` to resolve the project uid, and catalog order only resolves `org` first because
both shipped commands declare it.

Everything else — parsing, resolution, prompting, name-to-uid normalisation, retries, auth
headers, error mapping, exit codes, rendering — is inherited from `LaunchCommand`. If a new command
needs a change in `src/base/`, `src/flags/` or `src/http/`, that is a signal worth raising rather
than a routine edit.

**Confirm gate.** A destructive command opts in by adding `yes: {}` to its `inputs` — `--yes`
is deliberately not a global flag — and `await this.confirm('<question>')` at the top of `run()`.
It returns silently when `--yes` was passed, prompts on a TTY, exits 2 when there is neither, and
exits 3 when the user declines. Never assume a yes yourself.

**Exit codes.** `src/config/constants.ts` owns them and `LaunchCommand.catch()` is the only place
that maps an error to one:

| Code | Constant | Meaning |
|---|---|---|
| 0 | `EXIT_OK` | the command did what it was asked to do |
| 1 | `EXIT_RUNTIME` | a runtime failure — `LaunchApiError`, an unauthenticated session, anything oclif handles |
| 2 | `EXIT_USAGE` | a usage error — `UsageError`, `MissingInputError`, a failing cross-flag rule |
| 3 | `EXIT_CANCELLED` | the user declined a confirmation (`CancelledError`) |

A declined confirmation is a deliberate "no", not a failure, so it does not share code 1 with an
API 500 — a CI log has to be able to tell those apart. 130 would claim the process was killed by
SIGINT, which is not what happened.

**Cross-flag rules.** A rule that is pure flag-versus-flag and evaluable from argv alone belongs in
oclif's native `exclusive` / `relationships` on the catalog entry, where it also shows in `--help`.
A rule that must read a *resolved* value (one that config, a prompt or a default may have supplied)
belongs in `src/flags/rules.ts` — `exactlyOneOf`, `dependsOnValue`, `requiresFrameworkIn` — declared
as a `static rules = [...]` array on the command. `resolveInputs` evaluates them after resolution,
and a failing rule is a usage error (exit 2).

**Redaction.** Anything rendering an environment variable's value in a table or a detail block uses
`src/output/redact.ts` (`REDACTED`, `redactedColumn`). Confirmation text and error text are not
covered: nothing stops a future `variables:*` command from interpolating a value straight into
`this.confirm(...)` or a thrown error's message. Building that guard needs a debug logger and an
in-flight secret registry to redact against, neither of which exists yet — until one does, a command
handling variable values must redact them itself before they reach `confirm()` or an error message.

Required-ness is declared in `inputs`, never as an oclif `required: true` flag: oclif's parse-time
enforcement would fire before config or a prompt has had a chance to supply the value, so
required-ness is enforced after the resolution chain runs instead. A command must read
`this.resolved`, never `this.flags` — reading `this.flags` bypasses the resolution chain
(config file, prompt, default) entirely and returns only what was passed on argv.

## The cloud-function data URL loader

`src/util/cloud-function/load-data-url.ts` loads a built cloud function from a `data:` URL, and it
goes through `new Function('u', 'return import(u)')` instead of a plain `import(dataURL)`. That
indirection is load-bearing, not a style choice.

`tsconfig.json` sets `"module": "commonjs"`, so `tsc` rewrites a literal dynamic `import()` into
`Promise.resolve(...).then(s => __importStar(require(s)))`, and `require()` cannot load a `data:`
URL — the compiled CLI then fails with `MODULE_NOT_FOUND` on every `launch:functions` invocation
while the TypeScript sources and the unit tests stay green. `tsc` does not look inside a `Function`
constructor string, so the dynamic import survives compilation.

The repo used to carry `scripts/patch-load-data-url-file.js`, a post-`tsc` rollup step that
re-emitted the file as ESM, plus the `@rollup/plugin-typescript` dependency it needed. Both are
gone; do not reintroduce them, and do not "simplify" the loader back to a bare `import()`.

`test/integration/compiled-load-data-url.test.ts` guards this: it compiles the loader with the
project's own `compilerOptions` and runs the emitted CommonJS in a child `node` process against a
real `data:` URL. It has to be a child process — jest's VM cannot service a native dynamic import
without `--experimental-vm-modules` — and it deliberately lives outside `src/util/cloud-function/`,
which `jest.config.js` excludes from coverage collection.

## Commits

Use Conventional Commits — `feat(scope): subject`, `fix(scope): subject`, `test:`, `docs:`,
`chore:`, `refactor:`. Do not prefix a commit subject with a ticket id; reference the ticket in
the pull request instead.

## What does not belong in this repository

This repo holds the CLI and nothing else. Never commit AI tooling or process scaffolding here —
agent prompts, per-epic or per-ticket instructions, workflow runbooks, planning or hand-off
documents, or generated analysis. Those live in the developer workspace, outside this repo.

`AGENTS.md` and `README.md` are the exception: repo-scoped guidance that a contributor reads to
work on this codebase belongs here. A document written to drive an assistant through a ticket
does not.
