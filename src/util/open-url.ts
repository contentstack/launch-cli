type OpenModule = { default: (target: string) => Promise<unknown> };
type LoadOpen = () => Promise<OpenModule>;

const loadOpen: LoadOpen = async () => new Function('return import("open")')() as Promise<OpenModule>;

export async function openUrl(url: string, load: LoadOpen = loadOpen): Promise<void> {
  try {
    const { default: open } = await load();
    await open(url);
  } catch {
    return;
  }
}
