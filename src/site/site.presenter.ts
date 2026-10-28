import { styled } from '../core/style';

export const SITE_URL_NOT_FOUND = 'Website URL not found.';

export function siteOpeningLine(url: string, outputIsTTY: boolean): string {
  return styled(`✔ Opening ${url} in your browser...`, 'green', outputIsTTY);
}

export function siteUrlNotFoundLine(outputIsTTY: boolean): string {
  return styled(SITE_URL_NOT_FOUND, 'yellow', outputIsTTY);
}
