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
$ csdx plugins:install @contentstack/cli-launch@beta
$ csdx launch:projects:list --org <org-uid>
```

# Commands

The seven V1 command names (`launch`, `launch:deployments`, `launch:environments`, `launch:functions`,
`launch:logs`, `launch:open`, `launch:rollback`) appear below only because they still exist to refuse
with exit code 2 and name their V2 replacements. `launch:functions:serve` is live.

<!-- commands -->
* [`csdx help [COMMAND]`](#csdx-help-command)
* [`csdx launch`](#csdx-launch)
* [`csdx launch:cache:purge`](#csdx-launchcachepurge)
* [`csdx launch:deployments`](#csdx-launchdeployments)
* [`csdx launch:deployments:cancel`](#csdx-launchdeploymentscancel)
* [`csdx launch:deployments:create`](#csdx-launchdeploymentscreate)
* [`csdx launch:deployments:get`](#csdx-launchdeploymentsget)
* [`csdx launch:deployments:list`](#csdx-launchdeploymentslist)
* [`csdx launch:deployments:rollback`](#csdx-launchdeploymentsrollback)
* [`csdx launch:env:create`](#csdx-launchenvcreate)
* [`csdx launch:env:delete`](#csdx-launchenvdelete)
* [`csdx launch:env:get`](#csdx-launchenvget)
* [`csdx launch:env:list`](#csdx-launchenvlist)
* [`csdx launch:env:update`](#csdx-launchenvupdate)
* [`csdx launch:environments`](#csdx-launchenvironments)
* [`csdx launch:functions`](#csdx-launchfunctions)
* [`csdx launch:functions:serve`](#csdx-launchfunctionsserve)
* [`csdx launch:logs`](#csdx-launchlogs)
* [`csdx launch:logs:get`](#csdx-launchlogsget)
* [`csdx launch:open`](#csdx-launchopen)
* [`csdx launch:projects:create`](#csdx-launchprojectscreate)
* [`csdx launch:projects:delete`](#csdx-launchprojectsdelete)
* [`csdx launch:projects:get`](#csdx-launchprojectsget)
* [`csdx launch:projects:list`](#csdx-launchprojectslist)
* [`csdx launch:projects:update`](#csdx-launchprojectsupdate)
* [`csdx launch:rollback`](#csdx-launchrollback)
* [`csdx launch:site:open`](#csdx-launchsiteopen)
* [`csdx launch:variables:list`](#csdx-launchvariableslist)
* [`csdx launch:variables:set`](#csdx-launchvariablesset)
* [`csdx launch:variables:unset`](#csdx-launchvariablesunset)

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

## `csdx launch:cache:purge`

Purge an environment's CDN cache by path, cache tags or hostnames

```
USAGE
  $ csdx launch:cache:purge [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--path
    <value>] [--prefix] [--tags <value>] [--hosts <value>]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
      --env=<value>       Environment name or UID
      --hosts=<value>     Comma-separated hostnames to purge
      --org=<value>       Organization UID
      --path=<value>      Path to purge, for example /blog. End it with /* to purge everything beneath it, or pass /*
                          for the whole site
      --prefix            With --path, purge everything beneath the path as well (a prefix match, like ending it with
                          /*)
      --project=<value>   Project name or UID
      --tags=<value>      Comma-separated cache tags to purge

DESCRIPTION
  Purge an environment's CDN cache by path, cache tags or hostnames

EXAMPLES
  $ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --path /blog

  $ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --path /blog --prefix

  $ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --path "/blog/*"

  $ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --tags header,footer

  $ csdx launch:cache:purge --org <org-uid> --project <name-or-uid> --env <name-or-uid> --hosts www.example.com
```

_See code: [src/commands/launch/cache/purge.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/cache/purge.ts)_

## `csdx launch:deployments`

Removed in v2 - list deployments with launch:deployments:list

```
USAGE
  $ csdx launch:deployments

DESCRIPTION
  Removed in v2 - list deployments with launch:deployments:list
```

_See code: [src/commands/launch/deployments/index.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/deployments/index.ts)_

## `csdx launch:deployments:cancel`

Cancel a deployment of a Launch environment that is still in progress

```
USAGE
  $ csdx launch:deployments:cancel [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--deployment
    <value>] [-y]

FLAGS
  -c, --config=<value>      Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>    Current working directory
  -y, --yes                 Skip the confirmation prompt
      --deployment=<value>  Deployment UID
      --env=<value>         Environment name or UID
      --org=<value>         Organization UID
      --project=<value>     Project name or UID

DESCRIPTION
  Cancel a deployment of a Launch environment that is still in progress

EXAMPLES
  $ csdx launch:deployments:cancel --org <org-uid> --project <name-or-uid> --env <name-or-uid> --deployment <deployment-uid>

  $ csdx launch:deployments:cancel --org <org-uid> --project <name-or-uid> --env <name-or-uid> --deployment <deployment-uid> --yes
```

_See code: [src/commands/launch/deployments/cancel.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/deployments/cancel.ts)_

## `csdx launch:deployments:create`

Deploy a Launch environment: the branch tip or a chosen commit on a GitHub project, the project directory or the last uploaded bundle on a FileUpload project

```
USAGE
  $ csdx launch:deployments:create [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--commit
    <value> | --last-upload]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
      --commit=<value>    GitHub projects: deploy this commit. Pass --commit with no value to pick one from the recent
                          commits
      --env=<value>       Environment name or UID
      --last-upload       FileUpload projects: redeploy the last uploaded bundle without uploading a new one
      --org=<value>       Organization UID
      --project=<value>   Project name or UID

DESCRIPTION
  Deploy a Launch environment: the branch tip or a chosen commit on a GitHub project, the project directory or the last
  uploaded bundle on a FileUpload project

EXAMPLES
  $ csdx launch:deployments:create --org <org-uid> --project <name-or-uid> --env <name-or-uid>

  $ csdx launch:deployments:create --org <org-uid> --project <name-or-uid> --env <name-or-uid> --commit <sha>

  $ csdx launch:deployments:create --org <org-uid> --project <name-or-uid> --env <name-or-uid> --last-upload
```

_See code: [src/commands/launch/deployments/create.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/deployments/create.ts)_

## `csdx launch:deployments:get`

Show a deployment of a Launch environment, the latest one unless --deployment names another

```
USAGE
  $ csdx launch:deployments:get [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--deployment
    <value>]

FLAGS
  -c, --config=<value>      Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>    Current working directory
      --deployment=<value>  Deployment UID
      --env=<value>         Environment name or UID
      --org=<value>         Organization UID
      --project=<value>     Project name or UID

DESCRIPTION
  Show a deployment of a Launch environment, the latest one unless --deployment names another

EXAMPLES
  $ csdx launch:deployments:get --org <org-uid> --project <name-or-uid> --env <name-or-uid>

  $ csdx launch:deployments:get --org <org-uid> --project <name-or-uid> --env <name-or-uid> --deployment <deployment-uid>
```

_See code: [src/commands/launch/deployments/get.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/deployments/get.ts)_

## `csdx launch:deployments:list`

List the deployments of a Launch environment

```
USAGE
  $ csdx launch:deployments:list [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--limit
    <value>] [--skip <value>]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
      --env=<value>       Environment name or UID
      --limit=<value>     Number of records to fetch (1-1000)
      --org=<value>       Organization UID
      --project=<value>   Project name or UID
      --skip=<value>      Number of records to skip

DESCRIPTION
  List the deployments of a Launch environment

EXAMPLES
  $ csdx launch:deployments:list --org <org-uid> --project <name-or-uid> --env <name-or-uid>
```

_See code: [src/commands/launch/deployments/list.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/deployments/list.ts)_

## `csdx launch:deployments:rollback`

Roll a Launch environment back to a previous deployment

```
USAGE
  $ csdx launch:deployments:rollback [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--deployment
    <value>] [--reason <value>] [-y]

FLAGS
  -c, --config=<value>      Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>    Current working directory
  -y, --yes                 Skip the confirmation prompt
      --deployment=<value>  Deployment UID
      --env=<value>         Environment name or UID
      --org=<value>         Organization UID
      --project=<value>     Project name or UID
      --reason=<value>      Why the environment is being rolled back, recorded with the rollback

DESCRIPTION
  Roll a Launch environment back to a previous deployment

EXAMPLES
  $ csdx launch:deployments:rollback --org <org-uid> --project <name-or-uid> --env <name-or-uid> --deployment <deployment-uid>

  $ csdx launch:deployments:rollback --org <org-uid> --project <name-or-uid> --env <name-or-uid> --deployment <deployment-uid> --reason "bad release" --yes
```

_See code: [src/commands/launch/deployments/rollback.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/deployments/rollback.ts)_

## `csdx launch:env:create`

Create an environment in a Launch project and follow its first deployment

```
USAGE
  $ csdx launch:env:create [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--name <value>]
    [--description <value>] [--branch <value>] [--framework <value>] [--build-cmd <value>] [--server-cmd <value>]
    [--output-dir <value>] [--res-mode <value>] [--auto-deploy <value>] [--cs-auth <value>] [--var <value>...] [--dotenv
    <value>...] [--from-stack] [-a <value>] [--no-vars]

FLAGS
  -a, --alias=<value>        Alias of a delivery token saved with csdx auth:tokens:add, used with --from-stack without a
                             prompt
  -c, --config=<value>       Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>     Current working directory
      --auto-deploy=<value>  Deploy on every push, GitHub projects only (enable | disable)
      --branch=<value>       Git branch name, GitHub projects only
      --build-cmd=<value>    Build command
      --cs-auth=<value>      Contentstack Authentication (enable | disable)
      --description=<value>  Environment description (255 characters or fewer)
      --dotenv=<value>...    Path to a dotenv file, repeatable. Use - to read dotenv content from standard input
      --framework=<value>    Framework preset (Gatsby | NextJs | CRA | CSR | Analog | Angular | Nuxt | Astro | VueJs |
                             Remix | Other)
      --from-stack           Import the variables of a Contentstack stack. Asks for the stack and a delivery token on a
                             terminal
      --name=<value>         Environment name (200 characters or fewer)
      --no-vars              Create the environment with no variables, without asking for them on a terminal
      --org=<value>          Organization UID
      --output-dir=<value>   Output directory
      --project=<value>      Project name or UID
      --res-mode=<value>     Response mode (buffered | streaming)
      --server-cmd=<value>   Server command
      --var=<value>...       Environment variable as KEY=VALUE, repeatable. A KEY with no value is asked at a hidden
                             prompt, or read from standard input when piped

DESCRIPTION
  Create an environment in a Launch project and follow its first deployment

EXAMPLES
  $ csdx launch:env:create --org <org-uid> --project <name-or-uid> --name staging --branch develop --framework NextJs --build-cmd "npm run build" --output-dir .next --res-mode buffered

  $ csdx launch:env:create --org <org-uid> --project <name-or-uid> --name staging --data-dir ./site # a FileUpload project uploads the folder
```

_See code: [src/commands/launch/env/create.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/env/create.ts)_

## `csdx launch:env:delete`

Delete an environment of a Launch project

```
USAGE
  $ csdx launch:env:delete [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [-y]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
  -y, --yes               Skip the confirmation prompt
      --env=<value>       Environment name or UID
      --org=<value>       Organization UID
      --project=<value>   Project name or UID

DESCRIPTION
  Delete an environment of a Launch project

EXAMPLES
  $ csdx launch:env:delete --org <org-uid> --project <name-or-uid> --env <name-or-uid>

  $ csdx launch:env:delete --org <org-uid> --project <name-or-uid> --env <name-or-uid> --yes
```

_See code: [src/commands/launch/env/delete.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/env/delete.ts)_

## `csdx launch:env:get`

Show a single environment of a Launch project

```
USAGE
  $ csdx launch:env:get [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
      --env=<value>       Environment name or UID
      --org=<value>       Organization UID
      --project=<value>   Project name or UID

DESCRIPTION
  Show a single environment of a Launch project

EXAMPLES
  $ csdx launch:env:get --org <org-uid> --project <name-or-uid> --env <name-or-uid>
```

_See code: [src/commands/launch/env/get.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/env/get.ts)_

## `csdx launch:env:list`

List the environments of a Launch project

```
USAGE
  $ csdx launch:env:list [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--limit <value>] [--skip
    <value>]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
      --limit=<value>     Number of records to fetch (1-1000)
      --org=<value>       Organization UID
      --project=<value>   Project name or UID
      --skip=<value>      Number of records to skip

DESCRIPTION
  List the environments of a Launch project

EXAMPLES
  $ csdx launch:env:list --org <org-uid> --project <name-or-uid>
```

_See code: [src/commands/launch/env/list.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/env/list.ts)_

## `csdx launch:env:update`

Update an environment of a Launch project

```
USAGE
  $ csdx launch:env:update [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--name
    <value>] [--description <value>] [--branch <value>] [--framework <value>] [--build-cmd <value>] [--server-cmd
    <value>] [--output-dir <value>] [--res-mode <value>] [--auto-deploy <value>] [--cs-auth <value>] [--cache-priming
    <value>] [--password-protection <value>] [-u <value>] [-p] [-y]

FLAGS
  -c, --config=<value>               Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>             Current working directory
  -p, --password                     With --password-protection enable: read the password from standard input when there
                                     is no terminal (on a terminal it is asked at a hidden prompt)
  -u, --username=<value>             Password protection username, with --password-protection enable
  -y, --yes                          Skip the confirmation prompt
      --auto-deploy=<value>          Deploy on every push, GitHub projects only (enable | disable)
      --branch=<value>               Git branch name, GitHub projects only
      --build-cmd=<value>            Build command
      --cache-priming=<value>        Cache priming (enable | disable)
      --cs-auth=<value>              Contentstack Authentication (enable | disable)
      --description=<value>          Environment description (255 characters or fewer)
      --env=<value>                  Environment name or UID
      --framework=<value>            Framework preset (Gatsby | NextJs | CRA | CSR | Analog | Angular | Nuxt | Astro |
                                     VueJs | Remix | Other)
      --name=<value>                 Environment name (200 characters or fewer)
      --org=<value>                  Organization UID
      --output-dir=<value>           Output directory
      --password-protection=<value>  Password protection (enable | disable)
      --project=<value>              Project name or UID
      --res-mode=<value>             Response mode (buffered | streaming)
      --server-cmd=<value>           Server command

DESCRIPTION
  Update an environment of a Launch project

EXAMPLES
  $ csdx launch:env:update --org <org-uid> --project <name-or-uid> --env <name-or-uid> --build-cmd "npm run build"

  $ csdx launch:env:update --org <org-uid> --project <name-or-uid> --env <name-or-uid> --cache-priming disable --yes

  $ csdx launch:env:update --org <org-uid> --project <name-or-uid> --env <name-or-uid> --password-protection enable -u <username> -p

  $ printf '%s' "$PASSWORD" | csdx launch:env:update --org <org-uid> --project <name-or-uid> --env <name-or-uid> --password-protection enable -u <username> -p
```

_See code: [src/commands/launch/env/update.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/env/update.ts)_

## `csdx launch:environments`

Removed in v2 - list environments with launch:env:list

```
USAGE
  $ csdx launch:environments

DESCRIPTION
  Removed in v2 - list environments with launch:env:list
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
  -p, --port=<value>      [default: 3000] Port number

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

## `csdx launch:logs:get`

Read the build or server logs of a deployment of a Launch environment

```
USAGE
  $ csdx launch:logs:get [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--deployment
    <value>] [--since <value>] [--until <value>] [--search <value>] [--cursor <value>] [--type <value>]

FLAGS
  -c, --config=<value>      Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>    Current working directory
      --cursor=<value>      Server logs only: resume from the cursor printed by an earlier run
      --deployment=<value>  Deployment UID
      --env=<value>         Environment name or UID
      --org=<value>         Organization UID
      --project=<value>     Project name or UID
      --search=<value>      Server logs only: show only lines containing this text, up to 256 characters
      --since=<value>       Server logs only: start of the window, relative (45s, 30m, 12hr, 2d) or an ISO 8601
                            timestamp with an offset. Defaults to one hour before --until
      --type=<value>        Kind of logs to read (deployment | server | live). Defaults to deployment
      --until=<value>       Server logs only: end of the window, relative (45s, 30m, 12hr, 2d) or an ISO 8601 timestamp
                            with an offset. Defaults to now

DESCRIPTION
  Read the build or server logs of a deployment of a Launch environment

EXAMPLES
  $ csdx launch:logs:get --org <org-uid> --project <name-or-uid> --env <name-or-uid>

  $ csdx launch:logs:get --org <org-uid> --project <name-or-uid> --env <name-or-uid> --deployment <deployment-uid> --type server --since 2h
```

_See code: [src/commands/launch/logs/get.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/logs/get.ts)_

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
    <value>] [--env-name <value>] [--branch <value>] [--framework <value>] [--build-cmd <value>] [--server-cmd <value>]
    [--output-dir <value>] [--res-mode <value>] [--auto-deploy <value>] [--cs-auth <value>] [--var <value>...] [--dotenv
    <value>...] [--from-stack] [-a <value>] [--no-vars]

FLAGS
  -a, --alias=<value>        Alias of a delivery token saved with csdx auth:tokens:add, used with --from-stack without a
                             prompt
  -c, --config=<value>       Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>     Current working directory
      --auto-deploy=<value>  Deploy on every push, GitHub projects only (enable | disable)
      --branch=<value>       Git branch name, GitHub projects only
      --build-cmd=<value>    Build command
      --cs-auth=<value>      Contentstack Authentication (enable | disable)
      --description=<value>  Project description (255 characters or fewer)
      --dotenv=<value>...    Path to a dotenv file, repeatable. Use - to read dotenv content from standard input
      --env-name=<value>     Name of the environment created with the project (200 characters or fewer)
      --framework=<value>    Framework preset (Gatsby | NextJs | CRA | CSR | Analog | Angular | Nuxt | Astro | VueJs |
                             Remix | Other)
      --from-stack           Import the variables of a Contentstack stack. Asks for the stack and a delivery token on a
                             terminal
      --name=<value>         Project name (200 characters or fewer)
      --no-vars              Create the environment with no variables, without asking for them on a terminal
      --org=<value>          Organization UID
      --output-dir=<value>   Output directory
      --res-mode=<value>     Response mode (buffered | streaming)
      --server-cmd=<value>   Server command
      --type=<value>         Project type (GitHub | FileUpload)
      --var=<value>...       Environment variable as KEY=VALUE, repeatable. A KEY with no value is asked at a hidden
                             prompt, or read from standard input when piped

DESCRIPTION
  Create a Launch project, its first environment, and its first deployment

EXAMPLES
  $ csdx launch:projects:create --org <org-uid> --type GitHub --name <name> --env-name <environment> --branch main --framework NextJs --build-cmd "npm run build" --output-dir .next --res-mode buffered

  $ csdx launch:projects:create --org <org-uid> --type FileUpload --name <name> --env-name <environment> --data-dir ./site --framework Other --build-cmd "npm run build" --output-dir ./ --res-mode buffered

  $ csdx launch:projects:create --org <org-uid> --type GitHub --data-dir ./my-clone # the repository comes from the folder's GitHub remote
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
      --limit=<value>     Number of records to fetch (1-1000)
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
  $ csdx launch:projects:update

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

## `csdx launch:site:open`

Open an environment's live site in your browser, or print its URL when there is no terminal. On a terminal, when the environment has more than one domain, you choose which one to open; --deployment opens that deployment's preview URL without asking.

```
USAGE
  $ csdx launch:site:open [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--deployment
    <value>]

FLAGS
  -c, --config=<value>      Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>    Current working directory
      --deployment=<value>  Deployment UID
      --env=<value>         Environment name or UID
      --org=<value>         Organization UID
      --project=<value>     Project name or UID

DESCRIPTION
  Open an environment's live site in your browser, or print its URL when there is no terminal. On a terminal, when the
  environment has more than one domain, you choose which one to open; --deployment opens that deployment's preview URL
  without asking.

EXAMPLES
  $ csdx launch:site:open --org <org-uid> --project <name-or-uid> --env <name-or-uid>

  $ csdx launch:site:open --org <org-uid> --project <name-or-uid> --env <name-or-uid> --deployment <uid>

  $ url=$(csdx launch:site:open --org <org-uid> --project <name-or-uid> --env <name-or-uid>)
```

_See code: [src/commands/launch/site/open.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/site/open.ts)_

## `csdx launch:variables:list`

List the environment variables of an environment, with their values masked

```
USAGE
  $ csdx launch:variables:list [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--limit
    <value>] [--skip <value>]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
      --env=<value>       Environment name or UID
      --limit=<value>     Number of records to fetch (1-1000)
      --org=<value>       Organization UID
      --project=<value>   Project name or UID
      --skip=<value>      Number of records to skip

DESCRIPTION
  List the environment variables of an environment, with their values masked

EXAMPLES
  $ csdx launch:variables:list --org <org-uid> --project <name-or-uid> --env <name-or-uid>
```

_See code: [src/commands/launch/variables/list.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/variables/list.ts)_

## `csdx launch:variables:set`

Add or change environment variables from --var, --dotenv or a detected .env file; later sources win

```
USAGE
  $ csdx launch:variables:set [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--var
    <value>...] [--dotenv <value>...] [--from-stack] [-a <value>]

FLAGS
  -a, --alias=<value>      Alias of a delivery token saved with csdx auth:tokens:add, used with --from-stack without a
                           prompt
  -c, --config=<value>     Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>   Current working directory
      --dotenv=<value>...  Path to a dotenv file, repeatable. Use - to read dotenv content from standard input
      --env=<value>        Environment name or UID
      --from-stack         Import the variables of a Contentstack stack. Asks for the stack and a delivery token on a
                           terminal
      --org=<value>        Organization UID
      --project=<value>    Project name or UID
      --var=<value>...     Environment variable as KEY=VALUE, repeatable. A KEY with no value is asked at a hidden
                           prompt, or read from standard input when piped

DESCRIPTION
  Add or change environment variables from --var, --dotenv or a detected .env file; later sources win

EXAMPLES
  $ csdx launch:variables:set --org <org-uid> --project <name-or-uid> --env <name-or-uid> --var API_URL=https://example.test DEBUG=true

  $ csdx launch:variables:set --org <org-uid> --project <name-or-uid> --env <name-or-uid> --dotenv .env.staging

  $ printf '%s' "$TOKEN" | csdx launch:variables:set --org <org-uid> --project <name-or-uid> --env <name-or-uid> --var API_TOKEN
```

_See code: [src/commands/launch/variables/set.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/variables/set.ts)_

## `csdx launch:variables:unset`

Remove environment variables from an environment, after asking for confirmation

```
USAGE
  $ csdx launch:variables:unset [-c <value>] [-d <value>] [--org <value>] [--project <value>] [--env <value>] [--key
    <value>...] [-y]

FLAGS
  -c, --config=<value>    Path to the local '.cs-launch.json' file
  -d, --data-dir=<value>  Current working directory
  -y, --yes               Skip the confirmation prompt
      --env=<value>       Environment name or UID
      --key=<value>...    Environment variable key, repeatable
      --org=<value>       Organization UID
      --project=<value>   Project name or UID

DESCRIPTION
  Remove environment variables from an environment, after asking for confirmation

EXAMPLES
  $ csdx launch:variables:unset --org <org-uid> --project <name-or-uid> --env <name-or-uid> --key API_KEY

  $ csdx launch:variables:unset --org <org-uid> --project <name-or-uid> --env <name-or-uid> --key API_KEY --key DEBUG --yes
```

_See code: [src/commands/launch/variables/unset.ts](https://github.com/contentstack/launch-cli/blob/v2.0.0-beta.0/src/commands/launch/variables/unset.ts)_
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
