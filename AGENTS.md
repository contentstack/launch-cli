## Testing instructions

- Follow the Arrange, Act, Assert structure when writing unit tests.
- When writing unit tests, create individual unit tests that cover each logical branching in the code.
- For the happy path, can we have a single unit test where all the top level if conditions are executed? This might help with reducing the number of total unit tests created and still give same test coverage.
- For the tests for edge cases do not create separate describe blocks, keep the hierarchy flat.
- For the tests for edge cases, do not skip assertions, its still worth adding all assertions similar to the happy paths tests.
- Use only jest for writing test cases and refer existing unit test under the /src folder.
- Do not create code comments for any changes.

## Integration tests

- Unit tests mock the CLI's own classes, so they keep passing when behaviour changes.
  Integration tests (`test/integration/`) exist to catch what unit tests cannot: they run a
  real oclif command end to end and assert on what the CLI *does*.
- Run them with `npm run test:integration` (they are also part of `npm test`).
- Only three things are replaced: the terminal prompt (`inquirer`), the `open` package, and
  the Contentstack management SDK, which resolves its base URL as `https://<host>:443` and so
  cannot be pointed at a local server. Apollo, the GraphQL documents, the CLI config store,
  flag parsing, the filesystem and `git` all run for real.
- The Launch API is a local HTTP server (`test/integration/harness/launch-api.ts`) that the CLI
  reaches through a temporary region config. It records every GraphQL operation, so tests assert
  on the operations and variables the CLI actually sent rather than on internal method calls.
- Assert on the observable contract - operation sequence, request variables, prompt sequence,
  `.cs-launch.json` contents, stdout, exit code. Never stub a method on a command or adapter;
  that is what makes these tests survive a refactor and fail on a behaviour change.
- Register a response for every operation a flow needs and finish with
  `session.api.assertNoUnhandledOperations()` and `prompts.assertScriptFullyConsumed()`, so a
  renamed operation or an added prompt fails loudly instead of passing quietly.
- V2 (epic CL-4867) removes the bare `csdx launch` command in favour of `projects:create`,
  `environments:create` and `deployments:create`. `launch-github.test.ts` and
  `launch-file-upload.test.ts` therefore describe behaviour that has to be *ported* to those
  commands, not a command that survives — read a failure there as "the new command does something
  different", and repoint the spec rather than deleting the assertion.
- Tests named after a `CL-` ticket pin a bug that was already fixed once. Do not relax them.
- `forceExit: true` in the integration jest config papers over a known-benign open handle:
  oclif's `Config.load()` eagerly loads every command manifest, so `launch:functions` pulls in
  rollup's native bindings and their GC handle. The cost is that a *future* spec which genuinely
  hangs will force-exit instead of failing loudly — run `--detectOpenHandles` periodically to
  check nothing real is hiding behind it.
