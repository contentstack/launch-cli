import { MAX_PAGES } from './constants';

export interface PageWindow {
  limit: number;
  skip: number;
}

export async function* scanPages<P extends { pagination: { count?: number } }>(
  fetch: (window: PageWindow) => Promise<P>,
  entries: (page: P) => readonly unknown[],
  pageSize: number,
  scanLimit: () => Error,
): AsyncGenerator<P> {
  let skip = 0;

  for (let fetched = 0; fetched < MAX_PAGES; fetched += 1) {
    const page = await fetch({ limit: pageSize, skip });
    const count = entries(page).length;

    if (count === 0) {
      return;
    }

    yield page;

    if (count < pageSize) {
      return;
    }

    skip += count;
    const total = page.pagination.count;

    if (typeof total === 'number' && skip >= total) {
      return;
    }
  }

  throw scanLimit();
}
