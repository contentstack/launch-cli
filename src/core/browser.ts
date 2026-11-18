interface OpenModule {
  default: (target: string) => Promise<unknown>;
}

export type LoadOpen = () => Promise<OpenModule>;

// open is ESM-only; a Function-built import() survives tsc's CommonJS output, which would turn it into require().
export const loadOpen: LoadOpen = async () => new Function('return import("open")')() as Promise<OpenModule>;

/**
 * Opening a browser is a courtesy, never the point of a command: a headless box, a locked-down
 * desktop or a missing handler must not turn a reported problem into a crash, whether it fails by
 * rejecting or by throwing on the spawn.
 */
export async function openInBrowser(url: string, load: LoadOpen = loadOpen): Promise<void> {
  try {
    const { default: open } = await load();
    await open(url);
  } catch {
    return;
  }
}
