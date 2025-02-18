# Launch CLI plugin

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)

With Launch CLI, you can interact with the Contentstack Launch platform using the terminal to create, manage and deploy Launch projects.

<!-- toc -->
* [Launch CLI plugin](#launch-cli-plugin)
* [Installation steps](#installation-steps)
* [Commands](#commands)
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
$ csdx launch
start with launch flow <GitHub|FileUpload>
$ csdx launch:logs
To see server logs
$ csdx launch:logs --type d
To see deployment logs
$ csdx launch:functions
Run cloud functions locally
```

<!-- commandsstop -->



# How to test Changes Locally?
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


# Release & SRE Process:- 

Version Increment:

Patch version update (fixes): 1.0.0 → 1.0.1

Minor version update (enhancements): 1.0.0 → 1.1.0

Major version update (breaking changes): 1.0.0 → 2.0.0

## For release:

- Raise a draft pull request (PR) from the development branch to the main branch.

### Pre-release SRE Preparation:

- Create an SRE ticket a week before the release date, including the PR.

- After the SRE review, address any identified issues and create tickets for any new issues. 

- Request SRE approval if no issues are identified or after fixing all the SRE-raised issues.

### CAB Approval:

- For CAB, prepare deployment plan sheets(including publish & rollback plan).

- Once SRE approves, raise the request for CAB(SRE ticket, deployment plan, release tickets, release notes). At least two CAB approvals are required.

- Obtain approval for the PR from the security admin (Aravind) and launch admin.

### Merge and Release:

- After getting the necessary approvals, merge the PR. This will trigger the publishing process on npm and GitHub, which can be tracked through the actions & github released tags.

 

### How will changes be reflected in the CLI ?
If a patch or minor version of the launch is released, users will need to update or install the latest CLI version, which will automatically include the latest launch version.
`npm i -g @contentstack/cli`
     OR
`npm update -g @contentstack/cli`

 However, if a major version of the launch is released, a version bump is also required in CLI(Steps will be like this launch version bump -> cli version bump -> testing -> release).
