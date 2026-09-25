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
9. **A green run must be a run that could have failed.** Before adding a case, name the one-line
   source change that turns it red; if you cannot, do not add it. A parametrised case whose body
   can only assert what the compiler already guarantees, an expectation computed by re-running the
   implementation's own expression, and a fake whose recorded arguments no assertion reads are all
   coverage without a verdict. Prove numeric and timing contracts by mutation: flip one comparison
   or delete one line and show the case that goes red. This rule exists because
   `src/deployments/deployment.watcher.ts` reported 100% on all four metrics under both coverage
   engines while its tests killed 1 of 6 targeted mutants - the error-path fake discarded the delay
   it was handed, and nothing read the documented `now() + delay >= deadline` boundary.

**A defect the live harness finds is closed only with two tests.** When the live harness
(`docs/launch-cli-manual-tests`) finds a defect, it gets (1) a regression test that fails on the old
code and (2) a class-level test where one is feasible, before it is closed. The regression test pins
that bug; the class test fails on the *next* bug of the same kind, in code that does not exist yet.
Before writing a new class test, check the guards below: if the defect belongs to one of their
classes, extend that guard rather than adding a second one beside it. Each guard fails naming the
file and line that broke its rule, and each was proven red by reintroducing its defect.

| Guard | Rule it enforces | Found by |
|---|---|---|
| `src/core/prompt-types.guard.test.ts` | Every prompt call in `src` names a literal `type`, and every such type is registered with the real inquirer `cliux.inquire` uses once `LaunchCommand.init` has run. inquirer silently turns an unregistered type into a plain text box. | D1: `search-list` used, never registered |
| `test/integration/transport-content-type.test.ts` | For every method in `HTTP_METHODS`, a bodyless request carries no content type and a request with a body carries `application/json`, asserted on the wire. `withoutDefaultContentType` suppresses the utility client's default, so a bodyless POST, PUT or PATCH (for example `deployments:cancel`) no longer goes out as `application/x-www-form-urlencoded`. Only `utility-http-client.ts` builds an `HttpClient` and only `rest-client.ts` sets the JSON type. | D5: every DELETE sent `Content-Type: application/json` |
| `src/core/tty-streams.guard.test.ts` | `stdin.isTTY`, and the `isTTY` it becomes on the service context, are read only to decide whether the CLI may prompt (a read next to a prompt or a refusal to prompt) or on the plumbing lines that carry it there. Anything deciding what to draw reads `outputIsTTY` / `process.stdout.isTTY`. | D6: heartbeat drawn into a redirected file |
| `test/integration/retired-commands.test.ts` (named commands) | Every `launch:…` command named anywhere in `src` - a retirement message, a failure hint, an example - is either a registered command or on `PLANNED_COMMANDS` with the ticket that builds it, and a command drops off that list once it ships. | Review: retirement messages and hints pointed at commands the beta does not have |
| `src/core/prompt-funnel.guard.test.ts` | Every prompt goes through `LaunchCommand`'s `ux`, built once as `cancelOnInterrupt(cliux)`, so Ctrl-C at any prompt exits 3. No source calls `cliux.inquire` / `prompt` / `confirm` under any name, hands `cliux` on as a value, or imports a prompt library; `search-list.ts` may register a type but never prompt. | D2: Ctrl-C exited 130 |

A new prompt, request, render path or command is covered by these guards without being listed in
them. Do not add an exemption to a guard to make a new file pass: if a guard is wrong about a file,
fix the rule and prove the fixed rule still goes red on the original defect.

**Dynamic imports under Jest — read before adding a `loadDataURL` test.** `loadDataURL` uses
`new Function('u', 'return import(u)')` so the dynamic import survives the commonjs build; a plain
`import()` is rewritten by `tsc` into `require()`, which cannot load a `data:` URL and silently
broke every cloud function in `dist`. The cost is that Jest's default VM cannot service that import,
so the suite runs under `--experimental-vm-modules`. A second test file triggering a sandboxed
dynamic import in the same process was re-tested and did **not** hang (27 of 27 passed). What it did
do in this repo was **cost 327 seconds of wall time, silently** - no failure, no warning, just a
suite that took minutes instead of seconds. Remember that a `jest.mock()` **without a factory still
loads the real module** to build its automock, so an automock of anything that reaches
`loadDataURL` pays that cost as surely as a real import does. Keep every `loadDataURL` case in
`src/functions/cloud-functions.test.ts`, and if bare `npm test` jumps well past a minute with every
test green, look here first.

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
and the interactive picker. Fake the network with `nock`, never `RestApiClient`.

**Driving a prompt.** Use `test/support/terminal.ts`, never a local copy. `pretendTerminal()` (or
`onTerminal(run)`) makes `process.stdin.isTTY` report true for the run and restores it, because jest's
stdin is not a terminal and `LaunchCommand` reads it to decide whether prompting is allowed;
`stdinReportingTTY(value)` sets any other value, `undefined` included. It sets the property through a
descriptor, not by assignment: once another suite in the same process has turned stdin into a real
stream, `process.stdin.isTTY = true` throws, and jest orders test files by their previous runtime, so
that shows up as an intermittent failure rather than a stable one. `answerPrompts({ message: answer })`
installs the `cliux.inquire` spy, records every prompt's message and payload in order, and throws on a
prompt it was not given an answer for. `projects-create.test.ts` uses the three together to drive all
eleven GitHub prompts through `launch:projects:create`, asserting their order, their offered defaults
and the submitted body, and to prove that a flag-supplied value is never asked for.

Every Launch interceptor in `projects-create.test.ts` goes through `hub()`, which requires
`x-organization-uid`: a request sent under the wrong organization then fails instead of being
absorbed. Scope a new command's interceptors the same way.

`projects-delete.test.ts` drives the confirm gate end to end - `launch:projects:delete` is the
first shipped command declaring `yes: {}`, so exit 3 and the no-TTY refusal are now reachable
through `runCommand`. Both refusal paths are proven **at the wire**: the test registers the lookup
and delete interceptors, asserts the lookup was consumed and the DELETE was not, and listens on
nock's `no match` emitter so an unexpected request is recorded rather than silently absorbed. A mock
call count would not have caught a request the command made through a different client.

## Layout

```
src/
  core/         the command framework: LaunchCommand, the resolver engine, errors,
                exit codes, the core flag catalog (coreFlags), region derivation, the
                .cs-launch.json store, and the output primitives
  transport/    RestApiClient, the retry policy, auth strategies, proxy detection,
                and LaunchApiError / LaunchNetworkError - no CLI wording lives here
  projects/     one resource: repository, value object, domain service, presenter,
                error wording, prompt adapter, and the flags it contributes
  environments/ the environment DTOs, the framework preset table, and the environment
                flags every create command contributes
  deployments/  the deployment repository, the status classification, and the
                wait/stream loop that projects:create, deployments:create and logs:get
                all drive
  git/          the internal git-namespace / repository / branch lookups
  organizations/ the --org flag, its organization picker, and the lookup behind it,
                which reads the Contentstack Management API rather than Launch
  functions/    the cloud-function runtime and the serve flags, treated as a resource
  resources.ts  the composition root: it assembles the catalog, the resolution table,
                the dependency map and the api surface out of the resources
  commands/     thin oclif commands - wire and call
```

`core` and `transport` never import a resource except through `resources.ts`, and they
never import each other's wording. A resource imports `core` and `transport` freely.
`src/core/layering.test.ts` asserts this rather than leaving it to review: it reads every
source in `core/` and `transport/`, tests included, and fails on an import of a resource folder,
and it collects every cross-resource import in the non-test resource sources and fails on one the
allow-list does not name.
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

   Response types declare what can **arrive**, not what the service's DTO promises: `Project.uid`,
   `Project.name`, `Environment.uid`, `Deployment.uid` and `Pagination.count` are optional. Where a
   caller genuinely needs an id, the repository checks it with `hasUid` from
   `src/transport/envelope.ts` and raises a malformed-response error rather than hand back an entity
   nothing can address - `ProjectsApi.create`, `EnvironmentsApi.first` and `DeploymentsApi.latest`
   return `IdentifiedProject` / `IdentifiedEnvironment` / `IdentifiedDeployment`. A list consumer
   skips an entry with no uid. The envelope helpers take the bare noun phrase (`'project list'`) and
   choose both articles themselves.
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
`Flags.boolean` gives `boolean`. When the spec's `normalize` narrows the value, the narrower type is
what lands: a spec written `satisfies ResolutionSpec<string, never, FrameworkPreset>` makes
`this.resolved.framework` a `FrameworkPreset`, and `type`, `res-mode`, `auto-deploy` and `cs-auth`
arrive as `ProjectTypeChoice`, `ResponseMode` and `ToggleValue` the same way. It widens to
`| undefined` only when the input is
neither declared `required: true` nor given a `default` in its resolution spec. A command
should contain no casts at all; if one seems necessary, the type is wrong somewhere
above it.

A resolution entry declares what it needs resolved before it: the project spec carries
`dependsOn: PROJECT_DEPENDENCIES.project` (`['org']`) because its `prompt` and `normalize`
read `resolved.org`. `resolveInputs` resolves in dependency order, and between inputs with no dependency on each other,
in the order the `resolution` literal is written. That second rule is load-bearing in exactly one
place: `projectResolution` is spread before `organizationResolution`, so `projects:create` asks the
project type before the organization, as the pinned interactive order requires.
`test/integration/projects-create.test.ts` pins that order on the wire.
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
is deliberately not a global flag: it sits in `coreFlags` like `limit` (`org` lives in `src/organizations/`), and only
`LaunchCommand.baseFlags` (`--config`, `--data-dir`) reaches every command - and
`await this.confirm('<question>')` in `run()` before the first request that changes anything. Reads
before it are expected: `projects:delete` fetches the project so the question can name it.
It returns silently when `--yes` was passed, prompts on a TTY, exits 2 when there is neither, and
exits 3 when the user declines. Never assume a yes yourself.

**Retired V1 command names (FR27).** `launch` (bare), `launch:deployments`, `launch:environments`,
`launch:open`, `launch:logs`, `launch:rollback` and `launch:functions` still exist as commands, and
each one refuses with **exit 2** and the CLI's own message naming its V2 replacement. They exist as
commands rather than as nothing at all precisely so the message is ours: deleting the file would
give oclif's "command not found", which tells a V1 user nothing about where the command went.

`src/core/retired-command.ts` holds `RetiredCommand`, which declares `retiredName` and
`replacements` and never parses argv - so a retired name refuses identically whether or not V1 flags
are passed alongside it. A retired command file contains those two statics and a description,
nothing else.

`launch:functions` is a retired **topic name with a live child**: `launch:functions:serve` still
routes to its own command. `test/integration/retired-commands.test.ts` pins one case per retired
name and pins that the child is still reachable; do not collapse those into one parametrised case
that a rename could silently shrink.

**`projects:delete` and the confirm order.** The guarantee is precise: **nothing is changed before the
gate** - declining, or running without a TTY and without `--yes`, never sends the `DELETE`. It is not
"no request before the gate", and it cannot be: choosing the project is itself a read. The organization
picker lists organizations, the project picker lists projects, and `--project <name>` is resolved to a
uid by scanning the organization, all in the resolution chain before `run()`. `run()` then fetches the
project so the question names it the way the user knows it - `Delete project "<name>" (<uid>)? This
cannot be undone.`, falling back to the uid alone when the API returns no name - and only then asks.
Asking first and resolving afterwards was rejected: the question could only echo what was typed, a
picked project would be named by a uid the user never saw, and a name that matched nothing would be
reported only after the user had said yes. A failed lookup therefore surfaces before any question.
The success line reports the fetched name too - `✔ Project "<name>" deleted.`

**The organization prompt.** `--org` resolves flag -> `.cs-launch.json` -> prompt (TTY only), and
the prompt is `promptForOrganization` in `src/organizations/organization.prompt.ts`, so every command
that declares `org` inherits it. The management service has no organization-listing endpoint, so the
lookup reads the **Contentstack Management API** through the management SDK, as V1 did:
`src/transport/cma-client.ts` opens one SDK client per command on the region's `cma` host and adapts
it to the narrow `CmaSession` interface, and `OrganizationsApi` in `src/organizations/organizations.api.ts`
is the repository over it. `organizations` is a resource folder like any other, so `core` never imports
it and `layering.test.ts` lists it with no outgoing edges.

- **Paging.** `fetchAll({ limit: 100, asc: 'name', include_count: true, skip })`, advancing `skip` by
  100. It stops on a page shorter than 100 (an empty page included) or once `skip + items` reaches the
  reported `count`, and after `MAX_PAGES` full pages it raises rather than loop.
- **OAuth scope.** When the session carries `oauthOrgUid`, only that organization is fetched and it
  is used without asking; a line says which one.
- **Failure** of either call is an `OrganizationLookupError` (exit 1) in the CLI's own words, never a
  raw SDK error, and it suggests `--org`.
- The picker labels each organization by name and resolves to its uid. Text typed at the search list
  that matches neither a uid nor a name is a usage error, not a crash.

`MissingInputError` names only the remedies that exist for the flag it is about: "set it in
`.cs-launch.json`" only when the spec has a `configPath`, "run in an interactive terminal" only when
it has a prompt (or, for `projects:create`, when the creator asks for it).

**`projects:update` and client-side field limits.** The command sends `PUT /projects/:uid` with
`{name?, description?}` - the only two fields `UpdateProjectInput` declares in
`contentfly-management-service` (`src/projects/models/rest/project.input.ts`). Its limits are read
from that DTO, not from a doc: `@MaxLength(200)` on `name` and `@MaxLength(255)` on `description`,
mirrored as `PROJECT_NAME_MAX_LENGTH` / `PROJECT_DESCRIPTION_MAX_LENGTH` in
`src/projects/project.inputs.ts` and enforced in each flag's `normalize`, so a value from config or
a prompt is checked as well as one from argv.

Supplying neither flag is a usage error raised by `atLeastOneOf('name', 'description')` in
`src/core/rules.ts` - the API would answer `BODY_EMPTY`, and a round trip to be told that is worse
than exit 2. Rules run after the resolution chain, so a `--project <name>` still costs its
name-to-uid lookup before the rule fires; only the `PUT` is avoided. The success lines report the
value the **API confirmed**, falling back to the requested value if the response omits the field, so
a server-side normalisation is not reported as something it was not.

`--name` and `--description` live in `src/projects/project.inputs.ts` because their limits are the
project DTO's. When `environments:*` needs its own `--name`, the flat catalog key `name` is already
taken and the two resources' limits may differ - settle that when the first one needs it rather than
promoting these to `src/core/catalog.ts` now.

**Exit codes.** `src/core/constants.ts` owns them, every Launch error carries its own, and
`LaunchCommand.catch()` is one branch that reads it:

| Code | Constant | Meaning |
|---|---|---|
| 0 | `EXIT_OK` | the command did what it was asked to do |
| 1 | `EXIT_RUNTIME` | a runtime failure - `LaunchApiError`, `LaunchNetworkError`, `UnauthenticatedError`, anything oclif handles |
| 2 | `EXIT_USAGE` | a usage error - `UsageError`, `MissingInputError`, a failing cross-flag rule |
| 3 | `EXIT_CANCELLED` | the user declined a confirmation or chose nothing at a picker (`CancelledError`) |

`launch:functions:serve` is deliberately a plain oclif `Command` rather than a
`LaunchCommand`, because it talks to no API and needs no auth gate, and it is **outside**
this contract on purpose: the product owner's instruction is no functional difference from
V1 in `serve`. Its port handling is V1's, byte for byte:

- The port is `process.env.PORT || flags.port`, applied by the command after parsing. A set
  `PORT` beats an explicit `--port`, and an empty `PORT` falls through to the flag. The
  `--port` flag therefore does **not** declare `env: 'PORT'` - oclif's precedence (argv
  first) is the opposite of V1's, and restoring it would be a behaviour change.
- An invalid port prints `Invalid port number. Please provide a valid port number between 0
  and 65535.` **once**, through the restored V1 logger (`src/functions/function.logger.ts`),
  which writes every level - `error` included - to **stdout**, as winston's `Console`
  transport does without `stderrLevels`, and records it in `logs/error.log`. The command
  then calls `this.exit(EXIT_RUNTIME)`: exit **1**, and nothing on stderr. Do not add a
  `this.error(...)` after the log line - that was a second print and an exit 2.

Three V1 defects stay fixed and are the only approved differences: an empty or whitespace
port, from either `--port` or `PORT`, is rejected through that same one-message exit-1 path
(V1 accepted it because `Number('') === 0` and served on a random port); a busy port raises
`PortInUseError` and exits 2 with a clean message (V1 crashed on an unhandled `error`
event); and filepath validation is linear-time (V1's regex took 41 seconds on a plausible
40-character filename). `test/integration/functions-serve-port.test.ts` pins the port
precedence and the single message end to end.

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
services answer with; either way it happens at most once per request. A 401 whose error code is in
the `launch.GIT_PROVIDER.` namespace is **not** a session problem - `POST /projects` answers 401 when
Launch cannot reach the user's GitHub account - so it never triggers a refresh or a resend, and it is
reported with the CLI's own GitHub wording rather than "run csdx auth:login".

**Transport failures.** `createUtilityHttpClient` disarms the cli-utilities response
interceptor, which carried four behaviours, so our layer owns all four. The proxy
diagnostic and the body-triggered refresh above are reimplemented; the BASIC session
wording is reimplemented as `SessionExpiredError`; the interceptor's **method-blind**
one-shot retry is deliberately not, because it repeated POSTs. In its place
`diagnoseTransportError` turns any transport failure into a `LaunchNetworkError` carrying
CLI wording and a `retryable` flag, and `RetryPolicy.shouldRetryTransportError` retries one
only on an idempotent method, on the same budget as a 429. `test/integration/transport-socket-hangup.test.ts`
proves on a real socket that a POST is put on the wire exactly once.

Every request carries a timeout (`DEFAULT_REQUEST_TIMEOUT_MS`, 60 s; `requestTimeoutMs` overrides it),
so a server that accepts the connection and never answers cannot hang a command or push the deployment
watcher past its deadline; the abandoned request is a retryable `LaunchNetworkError` for GET/HEAD and a
one-shot failure for anything else. GET and HEAD are also retried on 502, 503 and 504, never a
mutation, because the server may already have acted on it. A `Retry-After` given in whole seconds
lengthens the wait up to `MAX_RETRY_AFTER_MS` (30 s); an HTTP date or anything unparseable falls back
to the policy's own backoff.

A proxy URL shown in a diagnostic has its `user:…@` part removed first (`withoutCredentials`), and
`https_proxy`/`http_proxy` are read as well as the uppercase names.

An API error body is untrusted input. `parseErrorEnvelope` reads it entry by entry and keeps only a
string `code` and a string `message` from each, so a malformed body falls back to the status wording
rather than surfacing `[object Object]` or a code of the wrong type. The management service sends a
validation failure **field-named** - `errors: [{ "<field>": { code, message } }]`
(`all-http-exception.filter.ts`) - and an entry with exactly one key whose value is an object is read
that way, keeping the field name; without it every validation 400 read "request failed with status
400".

**The `.cs-launch.json` file.** `ProjectConfigStore` owns it. `load()` returns a typed
`ProjectConfig`, applying the v1 rule that several branch blocks are usable only when they
agree on one project. A resolution spec addresses it by a key of `ProjectConfig`, never a
dotted string. `load()` keeps only the three keys a resolution spec can read - `uid`,
`organizationUid` and `name` - and only when each is a string or `null`, so a number in the file is
absent rather than a value that reaches a request header. `save()` has one caller, `projects:create`,
which records the project it created. It merges into every branch block, keeping every other key it
finds there; it writes a single `project` block into a missing file or one holding an empty object; it refuses, as a
`UsageError`, to overwrite a block that already names a different project; and it **never
overwrites a file it cannot parse as a config object**: invalid JSON, an array or any other non-object root, or a path it cannot read is a
`UsageError` ending "It was left unchanged.", whether or not the user named the path. The create
reports that line and still exits 0, because the project exists; losing a user's file to recover
from a typo in it is the wrong trade. A missing file is simply written fresh.

`LaunchCommand` reads the default-location file only when a resolution spec first needs a value from
it (`projectConfigLoader`), so a V1 file whose branch blocks disagree does not block a command whose
flags already supply everything; a file named with `--config` is still read at once.

The store's second constructor argument says whether the path was one the **user named**.
At the implicit default path a missing or unreadable file is simply an empty config; at a
path the user passed with `--config` it is a `UsageError` naming the path, because silence
there produced "Missing required value for --org" for a typo, a directory and a corrupt
file alike.

**Pagination constants.** `src/core/constants.ts` owns four numbers and they are deliberately not
one number reused four times. `contentfly-management-service`'s `PaginationArgs` is
`limit: number = 10` with `@IsOptional()` and **no** `@Max()`, so the API's own default is 10 and
there is **no server-side maximum at all**.

| Constant | Value | What it is |
|---|---|---|
| `DEFAULT_LIMIT` | 100 | what `limit` resolves to when nobody passed it. `projects:list` fetches one page and stops - it does not loop - so the default is one high page |
| `CLIENT_MAX_LIMIT` | 1000 | an honest **client-side sanity guard** on `--limit`, not a mirror of a server rule. There is no server rule to mirror. Do not "correct" it back to 100 because a doc table says 0-100. The **floor is 1**: the service sends `limit=0` straight to MongoDB, which reads it as no limit, so `--limit 0` would return the whole organization |
| `PICKER_PAGE_SIZE` | 100 | the page the interactive project picker fetches. It is separate from `CLIENT_MAX_LIMIT` on purpose: raising the client cap must never dump 1000 choices into a prompt |
| `MAX_PAGES` | 100 | how many pages a name-to-uid scan will walk before raising `ProjectScanLimitError` |

`PROJECT_SCAN_PAGE_SIZE` (100) lives in `src/projects/projects.api.ts` beside the `pages()`
generator it sizes, because it is that repository's paging decision and not a CLI-wide one.

**The deployment wait/stream loop.** `src/deployments/deployment.watcher.ts` polls a deployment to a
terminal state and is the single place any command waits on one. `POST /projects` creates the
project, its first environment **and** its first deployment, so `projects:create` is its first
consumer; `deployments:create` (CL-7170) and `logs:get` (CL-7171) take the same function.

The eight statuses in `contentfly-management-service`'s `DeploymentStatus` are **data**, held in
`src/deployments/types.ts`, and `classifyStatus` is the only thing that reads them:

| Kind | Statuses | Why |
|---|---|---|
| in-flight | `QUEUED`, `DEPLOYING` | the two the background-jobs service calls `INCOMPLETE_DEPLOYMENT_STATES` |
| success | `LIVE`, `DEPLOYED` | exactly the pair `DeploymentStatusNotifierService`'s `isSuccess` names before it attaches a preview URL — the same question the CLI asks before printing the site URL |
| failure | `ARCHIVED`, `SKIPPED`, `FAILED`, `CANCELLED` | declared, but not a deployment you can visit |
| unknown | anything else | a status the service added after this was written |

**Termination is proved, not assumed.** The loop ends three ways and no fourth: a success or failure
status, an overall deadline (`DEPLOYMENT_WAIT_TIMEOUT_MS`), or an error thrown by the poll, which
propagates. An **unknown** status is streamed verbatim and treated as in-flight rather than guessed
at, because a status the service adds is far more likely to be a new in-flight state than a new
terminal one, and reporting a healthy deployment as failed is worse than waiting out the deadline.
The deadline is what stops it, and the check is `now() + delay >= deadline` **before** sleeping, so
the loop never sleeps past its own deadline.

Backoff reuses `RetryPolicy.delayFor` - do not introduce a second retry concept. The step is capped
at `DEPLOYMENT_MAX_BACKOFF_STEPS` so a long deployment settles at a fixed poll interval.

Output is one line per **status change**, always. The `  ... still <STATUS>` heartbeat is printed
only when `isTTY`, so a CI log gets one line per transition and **no escape codes at all** - a test
asserts the absence of `\u001b`.

**Writing a test for it: the fake clock must advance.** `now()` and `sleep()` are injected and both
are required, not optional with defaults. A fake `now: () => 0` with a `sleep` that does nothing
makes the deadline unreachable and the suite **hangs** rather than failing - the same failure mode
as the `loadDataURL` rule below. Have `sleep` advance the same counter `now` reads.

**`projects:create`.** The command is thin; `ProjectCreator` in `src/projects/project.create.ts` is
the domain service, and `src/projects/project.create.prompt.ts` is a UI adapter that renders choices
and nothing more.

Interactive order is pinned by a test against the order a real `csdx launch` run prompts in: type ->
organization -> project name -> environment name -> (GitHub only: namespace -> repository -> branch)
-> framework -> build command -> output directory -> response mode. Type and organization are
resolution-spec prompts, because both are always asked and every command that declares `org` needs
its picker. The rest are **not**, because which of them run depends on `--type`, and the resolution
engine has no conditional dependency. Build command and server command are optional: an empty answer
at either means none, and the field is left out of the body. What the specs do own is `normalize`, so a value from config is validated
exactly like one from argv.

The framework gate is the declarative rule `onlyWithValueOf('server-cmd', 'framework', ...)`,
exported as `serverCommandFrameworkGate` and declared in `static rules` with `gitOnlyFlagRules`
(`--branch`, `--namespace`, `--repo` only with `--type GitHub`). A rule judges its gate only when the
user supplied the gate: with `--framework` on argv, a bad pairing costs exit 2 and nothing on the
wire. When the framework is prompted or detected later, `ProjectCreator` applies the same check
(`requireValueOf`) once it knows the framework, still before `POST /projects`.

**Without a terminal, create uses what it can infer.** The framework is the detected one (exit 2 naming
`--framework` when nothing was detected); the build and server commands are the detected ones, or none;
the output directory is the detected one, or the framework's V1 default (`OUTPUT_DIRECTORY_BY_FRAMEWORK`:
`./.next` for NEXTJS, `./build` for CRA and REMIX, and so on); the response mode is `buffered`. Each
inferred value is printed with the flag that overrides it. On a terminal the same values are the
prompt defaults. Type, project name and environment name have nothing to infer and stay required.

**A folder already linked to a project is refused up front.** If the `.cs-launch.json` create would
record into already names a project, create exits 2 before uploading or posting anything, naming that
project and `--config`.

**Deployment failure is a partial success, and the wording says so.** The project and environment are
real and are **not** rolled back. Everything after `POST /projects` - finding the first environment,
finding its first deployment, and the wait itself - goes through the same wording when it fails, so a
502 from a lookup still tells the user what exists. `deploymentFailureMessage` names the status, the project and
environment that survived, and both follow-up commands with their scope already filled in -
`deployments:create` to retry and `logs:get` to inspect. It exits **1**, not 2: nothing about the
invocation was wrong. A wait that runs out is worded differently: the deployment may still finish, so
the message says not to start another one and names `deployments:get` and `logs:get` instead of
`deployments:create`.

**The FileUpload archive.** `src/projects/project.archive.ts` owns the exclusion list
(`node_modules`, `.git`, `.env`, `.env.local`, `.next`, `logs`, `.vscode`, `.cs-launch.json`) and
applies it at **every** depth, except `logs`, which is left out only at the root (the CLI's own log
folder, as in V1) because a nested `logs/` is source such as a Next.js route. A `.zip` file at the root
is also left out, as V1 did. Each file keeps its permissions, so an executable script stays
executable. It also leaves out the file `--config` named when
that file lives inside the data dir, compared after path resolution, so a config kept under another
name is not deployed with the site. It skips symbolic links rather than following one
into a loop or out of the folder, and create prints which ones it skipped. A path that is not a directory, and a directory that is empty once the exclusions apply,
are both `UsageError` naming `--data-dir` - uploading an empty or wrong archive silently is worse
than refusing. `src/projects/project.upload.ts` splits into `prepareUpload` (pure: raw body, or
multipart when the signed URL carries form fields) and `uploadArchive` (the socket). A blank
`Content-Type` supplied by the presign is absent, as blank values are everywhere else, so the zip
content type is sent; anything outside 200-299, a 3xx redirect included, is an `UploadFailedError`,
and so is a socket that sends and receives nothing for `UPLOAD_IDLE_TIMEOUT_MS` (120 s) - an idle limit,
not a total one, so a large archive that is still moving is never cut off.
It uses `node:http`/`node:https` rather than `fetch` so `nock` can intercept it - nock 13 does not see
undici's `fetch`.

**Environment variables and argv.** `environmentVariables` is always `[]` on create: the variable
sources are CL-7169. The shape is built by a function that takes no input at all, so there is no
argv path into it to grow by accident, and a test passes `var`, `env-file` and `from-stack` into the
request to prove the body is unchanged. **No secret may reach argv** (FR30, G16).

**Cross-flag rules.** A rule that is pure flag-versus-flag and evaluable from argv alone belongs in
oclif's native `exclusive` / `relationships` on the flag definition, where it also shows in `--help` -
and a simple range does too: `limit` and `skip` carry oclif's own `min`/`max` rather than being
checked later. A rule that must read a *resolved* value (one that config, a prompt or a default may
have supplied) belongs in `src/core/rules.ts` - there are three: `atLeastOneOf` (used by
`projects:update`), `onlyWithValueOf` (used by `projects:create`) and `exactlyOneOf` (no consumer yet;
see "Built ahead of use" below) - declared as a `static rules = [...]` array on the command. `resolveInputs` evaluates them after resolution,
and a failing rule is a usage error (exit 2).

A rule asks what the **user supplied**, never what a default filled in. `resolveInputs` hands each rule
the resolved values and, beside them, the source of every present value (`flag`, `config`, `prompt` or
`default`). An input counts as supplied only when its source is not `default`, its value is not absent
by the resolver's own `isAbsent` (in `src/core/values.ts`, shared by both), and it is not `false`.
Without that, `skip`'s default of 0 made `exactlyOneOf('limit', 'skip')` reject `--limit 10` alone. The
gate value `onlyWithValueOf` reads is a value, not a "was it supplied?" question, so it is read
wherever it came from. Write the next rule when a command needs it; a rule
kept alive only by its own test proves nothing.

**Built ahead of use.** Four pieces of production code have no caller yet, on purpose, each held
for a named ticket whose shape it already fits. Nothing else in `src` is uncalled; add to this list
rather than leave an orphan unexplained.

| Code | Held for | Why its API fits |
|---|---|---|
| `EnvironmentsApi.list` | CL-7168 (`environments:*`) | `{org, project, limit, skip}` -> `EnvironmentsPage`, the paging every list command renders |
| `DeploymentsApi.list` | CL-7170 (`deployments:*`) | a `DeploymentScope` plus paging -> `DeploymentsPage` |
| `src/core/redact.ts` | CL-7169 (variables) | see below |
| `exactlyOneOf` | CL-7172 (`cache:purge`) | "purge these paths, or everything, not both" - and it judges what the user supplied, not defaults |

**Redaction.** `src/core/redact.ts` (`REDACTED`, `redactedColumn`) has no caller yet; it is kept
ahead of its first use on purpose, so the easy path for the first presenter that renders an
environment variable's value in a table or a detail block is the redacted one. Confirmation text
and error text are not covered: nothing stops a future `variables:*` command from interpolating a
value straight into `this.confirm(...)` or a thrown error's message. Building that guard needs a
debug logger and an in-flight secret registry to redact against, neither of which exists yet - until
one does, a command handling variable values must redact them itself before they reach `confirm()`
or an error message.

**Value helpers.** `src/core/values.ts` holds `withinLength` and `oneOf`, the two checks a
resolution spec's `normalize` reaches for. `oneOf` is case- and whitespace-insensitive and returns
the **canonical** option, which is what makes a doc label map cleanly onto a service enum. Both
resources use it rather than each writing their own.

**Doc labels are not service enum values.** The Commands Details page is the user-facing contract and
the management service is the wire contract, and for two flags they differ:

| Flag | What a user types (doc) | What the API receives (service) | Where |
|---|---|---|---|
| `--type` | `GitHub` \| `FileUpload` | `GITPROVIDER` \| `FILEUPLOAD` | `PROJECT_TYPE_BY_CHOICE` |
| `--framework` | `Gatsby`, `NextJs`, `CRA`, `CSR`, `Analog`, `Angular`, `Nuxt`, `Astro`, `VueJs`, `Remix`, `Other` | `GATSBY`, `NEXTJS`, `CRA`, `CSR`, `ANALOG`, `ANGULAR`, `NUXT`, `ASTRO`, `VUEJS`, `REMIX`, `OTHER` | `FRAMEWORK_PRESET_BY_LABEL` |

`GitHub -> GITPROVIDER` is a **rename**, not a case change, and `NextJs -> NEXTJS` does not survive a
naive `toUpperCase()` round trip in reverse. Both are explicit tables, and a test asserts the
framework table is a bijection onto the service enum so a preset cannot be added on one side only.

**Flag names are the short forms the code ships.** `--org`, `--env`, `--env-name`, `--build-cmd`,
`--server-cmd`, `--output-dir` and `--res-mode`, with no long-form aliases. The Commands Details page
(Confluence) still shows long forms in places (`--organization`, `--environment`) and is not edited
from here: each story ticket records its own differences from the page in a "Read first - skeleton
alignment" section, and the code outranks the page. `--env-name` is the environment created alongside
a project; `--name` stays the project name.

**Consumers still on V1.** The deployment agent (`contentfly-deployment-agent`) starts Azure and GCP
functions with `npx launch launch:functions` from a vendored `cli-launch@1.6.0` tarball
(`internal/cloudfunctionops/local-packages/`, `SERVER_COMMAND` in
`internal/cloudfunctionops/constants.go`). In 2.x `launch:functions` is a retired name that exits 2,
and the agent would then wait forever for a port that never opens. Never replace that tarball with a
2.x build without changing `SERVER_COMMAND` to `launch:functions:serve` in the same change. The same
applies to any customer `package.json` script that runs `launch:functions`: it is a release-note line
for 2.0, and the umbrella `@contentstack/cli` must keep pinning `cli-launch@^1` until 2.0 is GA.

**`this.dataDir`.** `LaunchCommand` already computed the data directory to find `.cs-launch.json`;
it now exposes it, because `projects:create` has to zip that same directory and `--data-dir` is a
base flag rather than a declared input, so `this.resolved` does not carry it. Read `this.dataDir`,
never `process.cwd()` and never `this.flags['data-dir']`.

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
