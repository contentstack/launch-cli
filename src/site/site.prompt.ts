import type { Choice, UxLike } from '../core/prompt';
import { askOption } from '../core/prompt';
import { bareHost, webUrlOf } from '../core/url';
import type { SiteDomain } from './site.url';

export const DOMAIN_QUESTION = 'Which domain do you want to open?';

export function domainChoices(defaultUrl: string, domains: readonly SiteDomain[] = []): Choice[] {
  const defaultHost = bareHost(defaultUrl);
  const seen = new Set([defaultHost.toLowerCase()]);
  const choices: Choice[] = [{ name: `${defaultHost} (default)`, value: defaultUrl }];

  for (const domain of domains) {
    const host = bareHost(domain.url ?? '');
    const url = webUrlOf(domain.url);

    if (url !== undefined && !seen.has(host.toLowerCase())) {
      seen.add(host.toLowerCase());
      choices.push({ name: host, value: url });
    }
  }

  return choices;
}

export async function askForDomain(ux: UxLike, choices: Choice[]): Promise<string> {
  return askOption(ux, DOMAIN_QUESTION, choices, choices[0].value);
}
