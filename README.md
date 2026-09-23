# Launch CLI plugin

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)

> **This is the V2 line.** V2 ships as `@contentstack/cli-launch@2.x` from `feature/development-v2`
> and carries only the `launch:<resource>:<verb>` taxonomy. V1 continues to ship as `1.x` from
> `development` with its existing commands and flags, supported and un-deprecated (PRD G10).
> The two are separate major versions of the same package; no V1 command name exists in V2.

With Launch CLI, you can interact with the Contentstack Launch platform using the terminal to create, manage and deploy Launch projects.

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
$ git clone clone <repo url>
$ npm install
$ npm run build
$ csdx plugins:link <plugin path>

NPM installation steps:
$ csdx plugins:install @contentstack/cli-launch
$ csdx launch
```

# Commands

```sh-session
$ csdx launch:projects:list --org <org-uid>
List the Launch projects in an organization

$ csdx launch:projects:get --org <org-uid> --project <name-or-uid>
Show a single project

$ csdx launch:functions:serve
Run cloud functions locally
```

<!-- commandsstop -->



# How to do development Locally?
- Branch out from development for development.
- Install npm: @contentstack/cli 
- Set region and log in using csdx config:set:region & csdx login

`node bin/dev <command-name>`

OR

`npm  run prepack`


`node bin/run <command-name>`

OR


```
npm run prepack

csdx plugins:link <plugin local path>

csdx <command-name>
```

# How to run tests Locally?
Step 1:- csdx config:set:region <region> Mentioned project should exists in provided org

Step 2:- csdx login

Step 3:- Create env on root level (refer: example.env file)

Step 4:- run test cases (`npm run test:unit` or `npm run test:unit:report`)



### How will changes be reflected in the CLI ?
If a patch or minor version of the launch is released, users will need to update or install the latest CLI version, which will automatically include the latest launch version.
`npm i -g @contentstack/cli`
     OR
`npm update -g @contentstack/cli`

 However, if a major version of the launch is released, a version bump is also required in CLI(Steps will be like this launch version bump -> cli version bump -> testing -> release).
