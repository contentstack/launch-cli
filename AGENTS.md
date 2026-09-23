## Testing instructions

- Follow the Arrange, Act, Assert structure when writing unit tests.
- When writing unit tests, create individual unit tests that cover each logical branching in the code.
- For the happy path, can we have a single unit test where all the top level if conditions are executed? This might help with reducing the number of total unit tests created and still give same test coverage.
- For the tests for edge cases do not create separate describe blocks, keep the hierarchy flat.
- For the tests for edge cases, do not skip assertions, its still worth adding all assertions similar to the happy paths tests.
- Use only jest for writing test cases and refer existing unit test under the /src folder.
- Do not create code comments for any changes.

**What the tests must prove.** Every rule below exists because a defect shipped past a green suite
at 100% coverage on all four metrics. Coverage counts lines executed, not assertions made — treat
the gate as a floor, never as evidence of correctness.

1. **`=== undefined` is not "absent."** `null`, `false`, `0` and `''` are values. Any guard that
   means "was this supplied?" gets tested with all five. A `null` in `.cs-launch.json` once
   defeated the required-input check entirely, and `--org ''` once satisfied `required: true`
   and then had its `x-organization-uid` header dropped by a truthiness check in the transport.
   The rule the resolver now applies: a string that is empty or whitespace only is **absent**,
   wherever it came from, and a value that reaches the transport is one the transport will send.
2. **A fake that ignores its arguments proves nothing.** Fakes record what they were called with,
   and tests assert it. A `baseUrl()` fake that discarded its argument is why a wrong API base path
   reached a live 404 with every test green.
3. **Every computed number gets boundary tests.** Pagination arithmetic, HTTP status edges
   (204/299/300/304), retry counts. Two impossible ranges — `Showing 201-50 of 50` and
   `Showing 1-0 of 50` — shipped because only the middle of the range was ever exercised.
4. **Every rendered field gets a fallback and an absent-field test.** An API field you did not mark
   optional will still arrive missing. A project with no name crashed `projects:list` outright.
5. **Precedence tests assert the losers.** Proving the winner won cannot distinguish precedence
   from luck — assert that the prompt was *not* called when a flag supplied the value.
6. **Do not test the test.** A test that only exercises object spread, or that a fixture has the
   shape the same test just gave it, asserts nothing about the code under test.
7. **Every `await` on a command path gets a rejection test.** Errors thrown by `normalize`, by an
   api module, or by a token refresh must be proven to propagate with the right type and exit code.
8. **No coverage exclusions.** If a path is too awkward to test, that is a design signal. Fencing
   it out of `collectCoverageFrom` makes the 100% gate report a number about a subset of the
   source, which is worse than no gate.

**Dynamic imports under Jest — read before adding a `loadDataURL` test.** `loadDataURL` uses
`new Function('u', 'return import(u)')` so the dynamic import survives the commonjs build; a plain
`import()` is rewritten by `tsc` into `require()`, which cannot load a `data:` URL and silently
broke every cloud function in `dist`. The cost is that Jest's default VM cannot service that import,
so the suite runs under `--experimental-vm-modules`, and **only one test file per process may
trigger a sandboxed dynamic import — a second one hangs the run rather than failing it**. Every
`loadDataURL` case therefore lives in `src/functions/cloud-functions.test.ts`. Add new
ones there. A hanging suite with no failing test is this constraint, not a flake.

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

Jest runs with `restoreMocks: true`, so a `jest.spyOn` does not layer a spy on a spy for
the life of a file; `test/credential-guard.setup.ts` re-installs its guard each test.

`projects-command-flows.test.ts` drives the flows that only exist end to end: the
project-folder flow (no flags, `.cs-launch.json` supplying org and project), `--config` at
an arbitrary path, an OAUTH session asserted on the wire including 401 -> refresh -> 200,
and the interactive picker. The picker needs `process.stdin.isTTY` set for the duration of
the run, because jest's stdin is not a terminal and `LaunchCommand` reads it to decide
whether prompting is allowed; restore it afterwards. Set it through a property descriptor,
not by assignment: once another suite in the same process has turned stdin into a real
stream, `process.stdin.isTTY = true` throws, and jest orders test files by their previous
runtime, so that shows up as an intermittent failure rather than a stable one. Fake the
network with `nock`, never `RestApiClient`.

The confirm gate is the one part of `LaunchCommand` `runCommand` cannot reach yet: no shipped
command declares `yes: {}`. It stays covered by `src/core/launch-command.test.ts` until one does.

## Layout

```
src/
  core/         the command framework: LaunchCommand, the resolver engine, errors,
                exit codes, the global flag catalog, region derivation, the
                .cs-launch.json store, and the output primitives
  transport/    RestApiClient, the retry policy, auth strategies, proxy detection,
                and LaunchApiError / LaunchNetworkError - no CLI wording lives here
  projects/     one resource: repository, value object, domain service, presenter,
                error wording, prompt adapter, and the flags it contributes
  functions/    the cloud-function runtime and the serve flags, treated as a resource
  resources.ts  the composition root: it assembles the catalog, the resolution table,
                the dependency map and the api surface out of the resources
  commands/     thin oclif commands - wire and call
```

`core` and `transport` never import a resource except through `resources.ts`, and they
never import each other's wording. A resource imports `core` and `transport` freely.
`src/core/layering.test.ts` asserts this rather than leaving it to review: it reads every
non-test source in `core/` and `transport/` and fails on an import of a resource folder.
That is why `Pagination` lives in `src/core/render.ts` beside `renderPagination` and
`src/projects/types.ts` re-exports it, not the other way round.
`resources.ts` is the only file every resource touches; everything else about projects
lives under `src/projects/`.

`src/commands/` mirrors the oclif topic path and nothing else: `launch:projects:list`
is `src/commands/launch/projects/list.ts`, and that path is the public contract. Topic
descriptions are declared in `package.json` under `oclif.topics`; without them oclif shows
a leaf command's description for the whole topic on every `csdx --help`.

## Adding a resource (V2)

A new resource - environments, variables, deployments, logs, cache - is a folder under
`src/` plus one line per contribution in `src/resources.ts`. Nothing else is shared.

1. **`src/<resource>/<resource>.api.ts`** - the repository. It takes a `RestApiClient`,
   returns typed data, and passes its own error wording to `client.request(req, MESSAGES)`.
   No `ux`, no prompts, no `process.exit` - a library module that calls `process.exit`
   takes the exit code out of the CLI's hands, which `CloudFunctions.serve` used to do.
   It re-exports its own `types.ts` so the DTOs have one import path.

   A repository that cannot finish what it was asked says so rather than returning a
   partial answer: paging past `MAX_PAGES` raises `ProjectScanLimitError`, because
   returning quietly made the resolver report "No project named X found in this
   organization" about a scan that never completed.
2. **`src/<resource>/<resource>.errors.ts`** - a `Record<code, message>` of the
   `launch.<RESOURCE>.*` codes this resource rewords. The transport never knows a
   message; it parses a body into a status, a code and the API's own text, and the
   repository supplies the CLI wording.
3. **`src/<resource>/<resource>.presenter.ts`** - columns and detail fields. Presentation
   never lives in a command file: a test that wants the columns imports the presenter.
4. **`src/<resource>/<resource>.inputs.ts`** - the flags this resource introduces and
   their resolution specs. Transcribe a flag from the Commands Details page
   §"All flags" tables and never set `required: true`. Catalog flag definition objects
   are shared by reference across every command that uses them - never mutate one in
   place. A resolution spec is written `{ ... } satisfies ResolutionSpec<T, D>`, where
   `T` is the value type and `D` names the inputs it depends on, so `resolved.org` is a
   `string` inside a prompt or normalize callback rather than something to cast. A spec
   may carry `configPath` (a key of `ProjectConfig`, checked at compile time),
   `dependsOn`, `prompt`, `normalize` and `default`.
5. **`src/resources.ts`** - spread the new flags into `catalog`, the new specs into
   `resolution`, the new dependencies into `DEPENDENCIES`, and add the repository to
   `ApiSurface` / `buildApi`. This is the one shared file, so expect to rebase on it.
6. **`src/commands/launch/<resource>/<verb>.ts`** - the command: a module-level
   `inputs({...})`, `static flags = flagsFor(...)`, and a `run()` that calls the api and
   renders through the presenter. Declare the spec at module level and extend
   `LaunchCommand<typeof theSpec>`; a class cannot reference its own static in its own
   `extends` clause.

Anything with domain behaviour - "is this a uid or a name?", "which uid does this name
have?" - is a value object and a domain service in the resource folder, not something
inlined into a prompt module or a resolution spec. `projects/project-ref.ts` and
`projects/project.resolver.ts` are the worked example: the prompt module is a UI adapter
that renders choices and nothing more.

**Typed resolved values.** `this.resolved.<flag>` carries the flag's own type, derived
from the catalog entry: `Flags.string` gives `string`, `Flags.integer` gives `number`,
`Flags.boolean` gives `boolean`. It widens to `| undefined` only when the input is
neither declared `required: true` nor given a `default` in its resolution spec. A command
should contain no casts at all; if one seems necessary, the type is wrong somewhere
above it.

A resolution entry declares what it needs resolved before it: the project spec carries
`dependsOn: PROJECT_DEPENDENCIES.project` (`['org']`) because its `prompt` and `normalize`
read `resolved.org`. `resolveInputs` resolves in dependency order, not in the order the
`resolution` literal happens to be written, so reordering that file changes nothing.
Declaring a dependency is the whole contract: a command that puts `project` in its
`inputs` without `org` is a **compile error** at the `inputs(...)` call (`Property 'org'
is missing`), and a spec that reaches `resolveInputs` cast past that check throws an
`InputDependencyError` naming both flags. A cycle between two entries throws the same
error naming the cycle rather than looping. `DEPENDENCIES` in `src/resources.ts` is the
single source: the runtime `dependsOn` and the compile-time constraint in
`src/core/inputs.ts` both read it. A key that is not a catalog flag is also a compile
error, so `inputs({ bogus: {} })` cannot ship.

Everything else - parsing, resolution, prompting, name-to-uid normalisation, retries,
auth headers, error mapping, exit codes, rendering - is inherited from `LaunchCommand`.
If a new resource needs a change in `src/core/` or `src/transport/`, that is a signal
worth raising rather than a routine edit.

**Confirm gate.** A destructive command opts in by adding `yes: {}` to its `inputs` - `--yes`
is deliberately not a global flag - and `await this.confirm('<question>')` at the top of `run()`.
It returns silently when `--yes` was passed, prompts on a TTY, exits 2 when there is neither, and
exits 3 when the user declines. Never assume a yes yourself.

**Exit codes.** `src/core/constants.ts` owns them, every Launch error carries its own, and
`LaunchCommand.catch()` is one branch that reads it:

| Code | Constant | Meaning |
|---|---|---|
| 0 | `EXIT_OK` | the command did what it was asked to do |
| 1 | `EXIT_RUNTIME` | a runtime failure - `LaunchApiError`, `LaunchNetworkError`, `UnauthenticatedError`, anything oclif handles |
| 2 | `EXIT_USAGE` | a usage error - `UsageError`, `MissingInputError`, a failing cross-flag rule |
| 3 | `EXIT_CANCELLED` | the user declined a confirmation or chose nothing at a picker (`CancelledError`) |

`launch:functions:serve` is deliberately a plain oclif `Command` rather than a
`LaunchCommand`, because it talks to no API and needs no auth gate - but it is inside the
same contract: a bad port is `this.error(..., { exit: EXIT_USAGE })` on stderr, and its
`--port` flag declares `env: 'PORT'` so oclif applies the usual precedence (argv, then the
environment, then the default) and shows it in `--help`. Never read `process.env` ahead of
a parsed flag.

A declined confirmation is a deliberate "no", not a failure, so it does not share code 1 with an
API 500 - a CI log has to be able to tell those apart. 130 would claim the process was killed by
SIGINT, which is not what happened.

A new error type subclasses `LaunchError` in `src/core/errors.ts` and declares its
`exitCode`; it needs no change in `LaunchCommand`. An error that means a contributor wired
a command wrongly stays a plain `Error` - `InputDependencyError` is the example - because
it is a bug report, not a CLI outcome.

**Auth.** One `AuthStrategy` is chosen once per command, by a factory that reads
`authorisationType` a single time: `BasicAuth` sends `authtoken` and answers a refresh with
`SessionExpiredError` ("Your session has timed out. Run csdx auth:login to continue."),
`OAuthAuth` sends a bearer token and refreshes with `compareOAuthExpiry(true)`.
Anything that is neither `BASIC` nor `OAUTH` is an `UnauthenticatedError`, which matches
cli-utilities' own `isAuthenticated()`. Nothing else may read `authorisationType`.

A refresh is triggered by an HTTP 401 **or** by a non-2xx body whose `error_message`
contains `access token is invalid or expired`, which is the shape some Contentstack
services answer with; either way it happens at most once per request.

**Transport failures.** `createUtilityHttpClient` disarms the cli-utilities response
interceptor, which carried four behaviours, so our layer owns all four. The proxy
diagnostic and the body-triggered refresh above are reimplemented; the BASIC session
wording is reimplemented as `SessionExpiredError`; the interceptor's **method-blind**
one-shot retry is deliberately not, because it repeated POSTs. In its place
`diagnoseTransportError` turns any transport failure into a `LaunchNetworkError` carrying
CLI wording and a `retryable` flag, and `RetryPolicy.shouldRetryTransportError` retries one
only on an idempotent method, on the same budget as a 429. `test/integration/transport-socket-hangup.test.ts`
proves on a real socket that a POST is put on the wire exactly once.

**The `.cs-launch.json` file.** `ProjectConfigStore` owns it. `load()` returns a typed
`ProjectConfig`, applying the v1 rule that several branch blocks are usable only when they
agree on one project. A resolution spec addresses it by a key of `ProjectConfig`, never a
dotted string. There is no `save()` yet: it had no production caller, and its
write-into-every-branch-block semantics are a design question the first command that needs
to write the file should settle.

The store's second constructor argument says whether the path was one the **user named**.
At the implicit default path a missing or unreadable file is simply an empty config; at a
path the user passed with `--config` it is a `UsageError` naming the path, because silence
there produced "Missing required value for --org" for a typo, a directory and a corrupt
file alike.

**Cross-flag rules.** A rule that is pure flag-versus-flag and evaluable from argv alone belongs in
oclif's native `exclusive` / `relationships` on the flag definition, where it also shows in `--help` -
and a simple range does too: `limit` and `skip` carry oclif's own `min`/`max` rather than being
checked later. A rule that must read a *resolved* value (one that config, a prompt or a default may
have supplied) belongs in `src/core/rules.ts` - `exactlyOneOf` is the only one so far - declared
as a `static rules = [...]` array on the command. `resolveInputs` evaluates them after resolution,
and a failing rule is a usage error (exit 2). Write the next rule when a command needs it; a rule
kept alive only by its own test proves nothing.

**Redaction.** `src/core/redact.ts` (`REDACTED`, `redactedColumn`) has no caller yet; it is kept
ahead of its first use on purpose, so the easy path for the first presenter that renders an
environment variable's value in a table or a detail block is the redacted one. Confirmation text
and error text are not covered: nothing stops a future `variables:*` command from interpolating a
value straight into `this.confirm(...)` or a thrown error's message. Building that guard needs a
debug logger and an in-flight secret registry to redact against, neither of which exists yet - until
one does, a command handling variable values must redact them itself before they reach `confirm()`
or an error message.

Required-ness is declared in `inputs`, never as an oclif `required: true` flag: oclif's parse-time
enforcement would fire before config or a prompt has had a chance to supply the value, so
required-ness is enforced after the resolution chain runs instead. A command must read
`this.resolved`, never `this.flags` - reading `this.flags` bypasses the resolution chain
(config file, prompt, default) entirely and returns only what was passed on argv.

## The cloud-function data URL loader

`src/functions/load-data-url.ts` loads a built cloud function from a `data:` URL, and it
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
real `data:` URL. It has to be a child process, because jest's own VM cannot service a native
dynamic import even with `--experimental-vm-modules`: the flag lets the suite run, but a compiled
`require()` regression would still have to be caught outside it.

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
