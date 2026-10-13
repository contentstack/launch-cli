# Integration-test fixtures

## Provenance

These fixtures have two sources, and every file now satisfies both:

1. the **published Launch OpenAPI specification**, which supplied the original shapes, and
2. a **live dogfood run against a real Launch dev environment on 2026-09-23**, which corroborated
   them and corrected two things the spec did not show.

| | |
|---|---|
| Spec URL | `https://launch-api.contentstack.com/openapi` |
| `openapi` | `3.0.0` |
| `info.version` | `1.0` |
| Date fetched | 2026-09-23 |
| Live corroboration | 2026-09-23, dev environment, `authtoken` + `x-organization-uid` + `x-cs-api-version: 1.0` |

| File | Spec location |
|---|---|
| `projects-list.json` | `paths./projects.get.responses.200.content.application/json.example` (schema `ProjectsResponse`) |
| `project-get.json` | `paths./projects/{project_uid}.get.responses.200.content.application/json.example` (schema `ProjectResponse`) |
| `project-get-fileupload.json` | same path and schema, shaped from the live FileUpload project observed on 2026-09-23 |
| `project-not-found.json` | `paths./projects/{project_uid}.get.responses.404.content.application/json.example` |

## What the live run corroborated

- The list envelope really is `{pagination: {count, limit, skip}, projects: [...]}`, and the single
  project envelope really is wrapped as `{project: {...}}`.
- The 404 body really is `{"errors":[{"code":"launch.PROJECT.NOT_FOUND","message":"Project not
  found."}],"status":404}`.
- `projectType` really is uppercase (`FILEUPLOAD`, `GITPROVIDER`).

## What the live run corrected

- **`pagination.skip` comes back `null`.** A request that sent `skip=0` was answered with
  `"skip": null`, so `projects-list.json` now carries `null` and `Pagination.skip` is typed
  `number | null`. `count` and `limit` came back as plain numbers and are left non-nullable.
- **A FileUpload project carries neither `repository` nor `description`.** The live project's keys
  were exactly `createdAt, createdBy, deletedAt, deletedBy, name, organizationUid, projectType,
  uid, updatedAt, updatedBy`. The third project in `projects-list.json` and the whole of
  `project-get-fileupload.json` now match that key set. The GitProvider projects, which do carry a
  `repository`, are kept from the spec because that shape is equally real and covers the branch the
  FileUpload shape does not.

## Identifier substitution

No real organization uid, project uid, project name or token appears in any fixture. The spec's
examples mask identifiers in a `68a327xxxxxxxx9d0d3` style, which is not a parseable value, and the
live values are real customer data. Both were replaced with synthetic values of the same shape,
consistently across every file:

- project `uid` → a 24-character lowercase hex string, so it matches the UID form
  `src/projects/project-ref.ts` recognises.
- `organizationUid`, `createdBy`, `updatedBy` → a `blt`-prefixed Contentstack uid.
- project and repository names → generic placeholders (`sample-project`, `marketing-site`,
  `docs-site`, owner `octo-user`).

Timestamps, `null`s, `pagination` values and `projectType` values are otherwise exactly as the spec
and the live environment return them.

## Inline wire shapes corrected from the service source (2026-09-24)

Some responses are shaped inline in the tests rather than in a file here. Two of them were written
from what the CLI assumed, agreed with the bug, and let a broken command pass at 100% coverage. They
now follow `contentfly-management-service` and a live dev11 response:

- **`GET /projects/upload/signed_url`** returns `{uploadUrl, expiresIn, uploadUid, method, fields?,
  headers?}` (`src/file-repository/models/rest/file-repository.rest.dto.ts:20-40`). A form field is
  `{formFieldKey, formFieldValue}` (`:4-10`); a header is `{key, value}` (`:12-18`). Both lists are
  nullable. AWS answers `POST` with eight S3 form fields and no headers
  (`src/storage-provider/aws-s3/aws-simple-storage.service.ts:215-240`); Azure and GCP answer `PUT`
  with headers and no fields (`src/storage-provider/constant.ts:4-18`). dev11 is AWS.
- **`DELETE /projects/:project_uid`** answers `204` with no body
  (`src/projects/controllers/projects.controller.ts:484-485`), and the Fastify server
  (`src/app/main.ts:67`) refuses a bodyless request declared `application/json` with `400`. The
  delete interceptors therefore refuse a request that carries a `content-type`.
