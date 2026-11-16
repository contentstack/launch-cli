type OpenModule = { default: (target: string) => Promise<unknown> };

// open is ESM-only from v11. Under "module": "commonjs" TypeScript compiles import() to require(),
// so the import is created at runtime to keep it a native dynamic import.
const importOpen = new Function('return import("open")') as () => Promise<OpenModule>;

/** Best effort: every caller prints the URL first, so a browser that cannot be opened is not an error. */
export async function openUrl(url: string): Promise<void> {
  try {
    const { default: open } = await importOpen();
    await open(url);
  } catch {
    // ignore
  }
}
