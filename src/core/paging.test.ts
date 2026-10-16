import { MAX_PAGES } from './constants';
import { scanPages } from './paging';

interface Page {
  pagination: { count?: number };
  items: number[];
}

function fetcher(pages: { count?: number; size: number }[]) {
  const windows: { limit: number; skip: number }[] = [];
  let index = 0;
  const fetch = async (window: { limit: number; skip: number }): Promise<Page> => {
    windows.push(window);
    const page = pages[Math.min(index++, pages.length - 1)];
    return { pagination: { count: page.count }, items: Array.from({ length: page.size }, (_, n) => n) };
  };

  return { fetch, windows };
}

async function drain(scan: AsyncGenerator<Page>): Promise<Page[]> {
  const collected: Page[] = [];
  for await (const page of scan) {
    collected.push(page);
  }
  return collected;
}

const LIMIT_ERROR = new Error('scan limit');
const scan = (fetch: (window: { limit: number; skip: number }) => Promise<Page>, pageSize = 2) =>
  scanPages(fetch, (page) => page.items, pageSize, () => LIMIT_ERROR);

describe('scanPages', () => {
  it('reads one page at a time, advancing skip by the entries returned, until a short page', async () => {
    const { fetch, windows } = fetcher([{ size: 2 }, { size: 1 }]);

    const pages = await drain(scan(fetch));

    expect(pages.map((page) => page.items.length)).toEqual([2, 1]);
    expect(windows).toEqual([
      { limit: 2, skip: 0 },
      { limit: 2, skip: 2 },
    ]);
  });

  it('stops on an empty page without yielding it', async () => {
    const { fetch, windows } = fetcher([{ count: 900, size: 0 }]);

    await expect(drain(scan(fetch))).resolves.toEqual([]);
    expect(windows).toHaveLength(1);
  });

  it('stops once the reported count is reached exactly, and reads on when one more remains', async () => {
    const exact = fetcher([{ count: 2, size: 2 }]);
    const oneMore = fetcher([{ count: 3, size: 2 }, { count: 3, size: 1 }]);

    await drain(scan(exact.fetch));
    await drain(scan(oneMore.fetch));

    expect(exact.windows).toHaveLength(1);
    expect(oneMore.windows).toHaveLength(2);
  });

  it('raises the caller its scan-limit error after MAX_PAGES full pages', async () => {
    const { fetch, windows } = fetcher([{ size: 2 }]);

    await expect(drain(scan(fetch))).rejects.toBe(LIMIT_ERROR);
    expect(windows).toHaveLength(MAX_PAGES);
  });

  it('fetches no further page once the reader stops', async () => {
    const { fetch, windows } = fetcher([{ count: 10, size: 2 }]);

    for await (const page of scan(fetch)) {
      expect(page.items).toHaveLength(2);
      break;
    }

    expect(windows).toHaveLength(1);
  });
});
