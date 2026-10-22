import nock from 'nock';

import projectFixture from '../fixtures/project-get.json';

export function projectOwnership(hubUrl: string, org: string, project: string): nock.Scope {
  return nock(hubUrl)
    .matchHeader('x-organization-uid', org)
    .matchHeader('x-project-uid', project)
    .get(`/manage/projects/${project}`)
    .reply(200, projectFixture);
}
