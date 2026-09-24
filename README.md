# Launch CLI plugin

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)

> **This is the V2 line.** V2 ships as `@contentstack/cli-launch@2.x` from `feature/development-v2`
> and carries only the `launch:<resource>:<verb>` taxonomy. V1 continues to ship as `1.x` from
> `development` with its existing commands and flags, supported and un-deprecated (PRD G10).
> The two are separate major versions of the same package. No V1 command runs in V2: each V1 name
> refuses with exit code 2 and names the V2 command that replaced it.

With Launch CLI, you can interact with the Contentstack Launch platform using the terminal. V2 ships
`launch:projects:create`, `:list`, `:get`, `:update` and `:delete`, plus `launch:functions:serve` to run
cloud functions locally; environments, deployments, logs and cache commands follow in later releases.

<!-- toc -->
* [Launch CLI plugin](#launch-cli-plugin)
* [Installation steps](#installation-steps)
* [Commands](#commands)
* [How to do development Locally?](#how-to-do-development-locally)
* [How to run tests Locally?](#how-to-run-tests-locally)
<!-- tocstop -->

# Installation steps

```sh-session
GitHub installation steps:
$ git clone <repo url>
$ git checkout feature/development-v2
$ npm install --@contentstack:registry=https://registry.npmjs.org
$ npm run build
$ csdx plugins:link <plugin path>

NPM installation steps:
$ csdx plugins:install @contentstack/cli-launch@2
$ csdx launch:projects:list --org <org-uid>
```

# Commands

The seven V1 command names (`launch`, `launch:deployments`, `launch:environments`, `launch:functions`,
`launch:logs`, `launch:open`, `launch:rollback`) appear below only because they still exist to refuse
with exit code 2 and name their V2 replacements. `launch:functions:serve` is live.

<!-- commands -->
* [`csdx help [COMMAND]`](#csdx-help-command)
* [`csdx launch`](#csdx-launch)
* [`csdx launch:deployments`](#csdx-launchdeployments)
* [`csdx launch:environments`](#csdx-launchenvironments)
* [`csdx launch:functions`](#csdx-launchfunctions)
* [`csdx launch:functions:serve`](#csdx-launchfunctionsserve)
* [`csdx launch:logs`](#csdx-launchlogs)
* [`csdx launch:open`](#csdx-launchopen)
* [`csdx launch:projects:create`](#csdx-launchprojectscreate)
* [`csdx launch:projects:delete`](#csdx-launchprojectsdelete)
* [`csdx launch:projects:get`](#csdx-launchprojectsget)
* [`csdx launch:projects:list`](#csdx-launchprojectslist)
* [`csdx launch:projects:update`](#csdx-launchprojectsupdate)
* [`csdx launch:rollback`](#csdx-launchrollback)

## `csdx help [COMMAND]`

Display help for csdx.

```
USAGE
  $ csdx help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for csdx.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.53/src/commands/help.ts)_

## `csdx launch`

Removed in v2 - create a project, environment or deployment with its own command

```
USAGE
  $ csdx launch

DESCRIPTION
  Removed in v2 - create a project, environment or deployment with its own command
```

_See code: [src/commands/launch/index.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/index.ts)_

## `csdx launch:deployments`

Removed in v2 - list deployments with launch:deployments:list

```
USAGE
  $ csdx launch:deployments

DESCRIPTION
  Removed in v2 - list deployments with launch:deployments:list
```

_See code: [src/commands/launch/deployments/index.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/deployments/index.ts)_

## `csdx launch:environments`

Removed in v2 - list environments with launch:environments:list

```
USAGE
  $ csdx launch:environments

DESCRIPTION
  Removed in v2 - list environments with launch:environments:list
```

_See code: [src/commands/launch/environments/index.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/environments/index.ts)_

## `csdx launch:functions`

Removed in v2 - serve cloud functions with launch:functions:serve

```
USAGE
  $ csdx launch:functions

DESCRIPTION
  Removed in v2 - serve cloud functions with launch:functions:serve
```

_See code: [src/commands/launch/functions/index.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/functions/index.ts)_

## `csdx launch:functions:serve`

Serve cloud functions

```
USAGE
  $ csdx launch:functions:serve [-p <value>] [-d <value>]

FLAGS
  -d, --data-dir=<value>  Current working directory
  -p, --port=<value>      [default: 3000, env: PORT] Port number

DESCRIPTION
  Serve cloud functions

EXAMPLES
  $ csdx launch:functions:serve

  $ csdx launch:functions:serve --port <port-number>

  $ csdx launch:functions:serve --data-dir <path/of/current/working/dir>

  $ csdx launch:functions:serve --data-dir <path/of/current/working/dir> -p <port-number>
```

_See code: [src/commands/launch/functions/serve.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/functions/serve.ts)_

## `csdx launch:logs`

Removed in v2 - read logs with launch:logs:get

```
USAGE
  $ csdx launch:logs

DESCRIPTION
  Removed in v2 - read logs with launch:logs:get
```

_See code: [src/commands/launch/logs/index.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/logs/index.ts)_

## `csdx launch:open`

Removed in v2 - open the site with launch:site:open

```
USAGE
  $ csdx launch:open

DESCRIPTION
  Removed in v2 - open the site with launch:site:open
```

_See code: [src/commands/launch/open.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/open.ts)_

## `csdx launch:projects:create`

Create a Launch project, its first environment, and its first deployment

```
USAGE
  $ csdx launch:projects:create [-c <value>] [-d <value>] [--org <value>] [--type <value>] [--name <value>] [--description
    <value>] [--env-name <value>] [--namespace <value>] [--repo <value>] [--branch <value>] [--framework <value>]
    [--build-cmd <value>] [--server-cmd <value>] [--output-dir <value>] [--res-mode <value>] [--auto-deploy <value>]
    [--cs-auth <value>]

FLAGS
  -c, --config=<value>       Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>     Current working directory
      --auto-deploy=<value>  Deploy on every push (enable | disable)
      --branch=<value>       Git branch name
      --build-cmd=<value>    Build command
      --cs-auth=<value>      Contentstack Authentication (enable | disable)
      --description=<value>  Project description (255 characters or fewer)
      --env-name=<value>     Name of the environment created with the project (200 characters or fewer)
      --framework=<value>    Framework preset (Gatsby | NextJs | CRA | CSR | Analog | Angular | Nuxt | Astro | VueJs |
                             Remix | Other)
      --name=<value>         Project name (200 characters or fewer)
      --namespace=<value>    Git namespace — the user or organization the repository belongs to
      --org=<value>          Organization UID
      --output-dir=<value>   Output directory
      --repo=<value>         Repository name, as <namespace>/<repository>
      --res-mode=<value>     Response mode (buffered | streaming)
      --server-cmd=<value>   Server command
      --type=<value>         Project type (GitHub | FileUpload)

DESCRIPTION
  Create a Launch project, its first environment, and its first deployment

EXAMPLES
  $ csdx launch:projects:create --org <org-uid> --type GitHub --name <name> --env-name <environment> --namespace <git-namespace> --repo <namespace/repo> --branch main --framework NextJs --build-cmd "npm run build" --output-dir .next --res-mode buffered

  $ csdx launch:projects:create --org <org-uid> --type FileUpload --name <name> --env-name <environment> --data-dir ./site --framework Other --build-cmd "npm run build" --output-dir ./ --res-mode buffered
```

_See code: [src/commands/launch/projects/create.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/projects/create.ts)_

## `csdx launch:projects:delete`

Delete a Launch project

```
USAGE
  $ csdx launch:projects:delete [-c <value>] [-d <value>] [--org <value>] [--project <value>] [-y]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
  -y, --yes               Skip the confirmation prompt
      --org=<value>       Organization UID
      --project=<value>   Project name or UID

DESCRIPTION
  Delete a Launch project

EXAMPLES
  $ csdx launch:projects:delete --org <org-uid> --project <name-or-uid>

  $ csdx launch:projects:delete --org <org-uid> --project <name-or-uid> --yes
```

_See code: [src/commands/launch/projects/delete.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/projects/delete.ts)_

## `csdx launch:projects:get`

Show a single Launch project

```
USAGE
  $ csdx launch:projects:get [-c <value>] [-d <value>] [--org <value>] [--project <value>]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
      --org=<value>       Organization UID
      --project=<value>   Project name or UID

DESCRIPTION
  Show a single Launch project

EXAMPLES
  $ csdx launch:projects:get --org <org-uid> --project <name-or-uid>
```

_See code: [src/commands/launch/projects/get.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/projects/get.ts)_

## `csdx launch:projects:list`

List Launch projects in an organization

```
USAGE
  $ csdx launch:projects:list [-c <value>] [-d <value>] [--org <value>] [--limit <value>] [--skip <value>]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
      --limit=<value>     Number of records to fetch (0-1000)
      --org=<value>       Organization UID
      --skip=<value>      Number of records to skip

DESCRIPTION
  List Launch projects in an organization

EXAMPLES
  $ csdx launch:projects:list --org <org-uid>
```

_See code: [src/commands/launch/projects/list.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/projects/list.ts)_

## `csdx launch:projects:update`

Update a Launch project

```
USAGE
  $ csdx launch:projects:update [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--name <value>]
    [--description <value>]

FLAGS
  -c, --config=<value>       Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>     Current working directory
      --description=<value>  Project description (255 characters or fewer)
      --name=<value>         Project name (200 characters or fewer)
      --org=<value>          Organization UID
      --project=<value>      Project name or UID

DESCRIPTION
  Update a Launch project

EXAMPLES
  $ csdx launch:projects:update --org <org-uid> --project <name-or-uid> --name <new-name>

  $ csdx launch:projects:update --org <org-uid> --project <name-or-uid> --description <new-description>
```

_See code: [src/commands/launch/projects/update.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/projects/update.ts)_

## `csdx launch:rollback`

Removed in v2 - roll back with launch:deployments:rollback

```
USAGE
  $ csdx launch:rollback

DESCRIPTION
  Removed in v2 - roll back with launch:deployments:rollback
```

_See code: [src/commands/launch/rollback.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/rollback.ts)_
<!-- commandsstop -->

# How to do development Locally?
- Branch out from `feature/development-v2` for V2 work.
- Install the CLI: `npm install -g @contentstack/cli`
- Set a region and log in with `csdx config:set:region` and `csdx auth:login`

`node bin/dev.js <command-name>`

OR

```
npm run prepack
node bin/run.js <command-name>
```

OR

```
npm run prepack
csdx plugins:link <plugin local path>
csdx <command-name>
```

# How to run tests Locally?

The suite needs no region, login or environment file: every network call is faked with `nock`, and
`test/credential-guard.setup.ts` refuses to let a test read a real credential.

- `npm test` runs every unit and integration test in one process.
- `npm run test:coverage` does the same and enforces 100% statements, branches, functions and lines
  across all of `src`.
- `npm test -- path/to/file.test.ts` runs a single file.

### How will changes be reflected in the CLI ?
If a patch or minor version of the launch is released, users will need to update or install the latest CLI version, which will automatically include the latest launch version.
`npm i -g @contentstack/cli`
     OR
`npm update -g @contentstack/cli`

 However, if a major version of the launch is released, a version bump is also required in CLI(Steps will be like this launch version bump -> cli version bump -> testing -> release).
