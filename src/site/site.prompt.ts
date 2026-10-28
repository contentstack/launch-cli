import type { Choice, UxLike } from '../core/prompt';
import { askOption } from '../core/prompt';
import type { SiteDomain } from './site.url';

export const DOMAIN_QUESTION = 'Which domain do you want to open?';

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const TRAILING_SLASHES = /\/+$/;

function bareHost(url: string): string {
  return url.trim().replace(SCHEME, '').replace(TRAILING_SLASHES, '');
}

function withScheme(url: string): string {
  const trimmed = url.trim().replace(TRAILING_SLASHES, '');

  return SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function domainChoices(defaultUrl: string, domains: readonly SiteDomain[] = []): Choice[] {
  const defaultHost = bareHost(defaultUrl);
  const seen = new Set([defaultHost.toLowerCase()]);
  const choices: Choice[] = [{ name: `${defaultHost} (default)`, value: defaultUrl }];

  for (const domain of domains) {
    const host = bareHost(domain.url ?? '');

    if (host !== '' && !seen.has(host.toLowerCase())) {
      seen.add(host.toLowerCase());
      choices.push({ name: host, value: withScheme(domain.url as string) });
    }
  }

  return choices;
}

export async function askForDomain(ux: UxLike, choices: Choice[]): Promise<string> {
  return askOption(ux, DOMAIN_QUESTION, choices, choices[0].value);
}
