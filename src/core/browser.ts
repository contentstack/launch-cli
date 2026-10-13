import open from 'open';

/**
 * Opening a browser is a courtesy, never the point of a command: a headless box, a locked-down
 * desktop or a missing handler must not turn a reported problem into a crash, whether it fails by
 * rejecting or by throwing on the spawn.
 */
export function openInBrowser(url: string): void {
  try {
    void open(url).catch(() => undefined);
  } catch {
    // A browser we cannot launch changes nothing about the message this accompanies.
  }
}
