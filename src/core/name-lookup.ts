import { hasUid } from '../transport/envelope';
import type { ResourceRef } from './resource-ref';

interface Named {
  uid?: unknown;
  name?: unknown;
}

export async function uidByName<P, T extends Named>(
  pages: () => AsyncIterable<P>,
  entriesOf: (page: P) => readonly T[],
  ref: ResourceRef,
  notFound: (name: string) => Error,
): Promise<string> {
  if (ref.kind === 'uid') {
    return ref.uid;
  }

  for await (const page of pages()) {
    const match = entriesOf(page).filter(hasUid).find((entry) => entry.name === ref.name);

    if (match) {
      return match.uid;
    }
  }

  throw notFound(ref.name);
}
