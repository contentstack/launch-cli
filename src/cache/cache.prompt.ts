import type { UxLike } from '../core/prompt';
import { answered, askChoices, askOption } from '../core/prompt';
import { cacheResolution, splitList } from './cache.inputs';
import type { PurgeTarget } from './types';

type Mode = 'path' | 'tags' | 'hosts';

const PATH_QUESTION = 'Path to purge (for example /blog)';
const PREFIX_QUESTION = 'Purge everything under this path? (prefix match)';
const TAGS_QUESTION = 'Cache tags to purge (comma-separated)';
const HOSTS_QUESTION = 'Which hostnames do you want to purge?';
const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const TRAILING_SLASHES = /\/+$/;

export function domainHostnames(domains: readonly { url?: string }[] | undefined): string[] {
  const hostnames = (domains ?? [])
    .map((domain) => (domain.url ?? '').trim().replace(SCHEME, '').replace(TRAILING_SLASHES, ''))
    .filter((hostname) => hostname !== '');

  return [...new Set(hostnames)];
}

function pathProblem(value: string): true | string {
  return value.trim().startsWith('/') ? true : 'The path must start with "/", for example /blog.';
}

function tagsProblem(value: string): true | string {
  return splitList(value).length > 0 ? true : 'Enter at least one cache tag.';
}

async function askValidated(
  ux: UxLike,
  message: string,
  validate: (value: string) => true | string,
): Promise<string> {
  return answered(await ux.inquire<string | undefined>({ type: 'input', name: 'value', message, validate })).trim();
}

async function askPath(ux: UxLike): Promise<PurgeTarget> {
  const typed = await askValidated(ux, PATH_QUESTION, pathProblem);
  const path = await cacheResolution.path.normalize(typed);

  if (path.isPrefix) {
    return { path };
  }

  const prefix = await ux.inquire<boolean | undefined>({
    type: 'confirm',
    name: 'value',
    message: PREFIX_QUESTION,
    default: false,
  });

  return { path: { ...path, isPrefix: prefix === true } };
}

async function askTags(ux: UxLike): Promise<PurgeTarget> {
  return { tags: splitList(await askValidated(ux, TAGS_QUESTION, tagsProblem)) };
}

async function askHosts(ux: UxLike, hostnames: string[]): Promise<PurgeTarget> {
  const choices = hostnames.map((hostname) => ({ name: hostname, value: hostname }));

  return { hosts: await askChoices(ux, HOSTS_QUESTION, choices) };
}

export async function promptForCriterion(ux: UxLike, hostnames: string[]): Promise<PurgeTarget> {
  const choices: { name: string; value: Mode }[] = [
    { name: 'Path', value: 'path' },
    { name: 'Cache tags', value: 'tags' },
    ...(hostnames.length > 0 ? [{ name: 'Hostnames', value: 'hosts' as const }] : []),
  ];
  const mode = await askOption(ux, 'What do you want to purge?', choices);

  if (mode === 'path') {
    return askPath(ux);
  }

  return mode === 'tags' ? askTags(ux) : askHosts(ux, hostnames);
}
