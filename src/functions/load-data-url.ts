export type LoadedModule = Record<string, unknown>;

export function loadDataURL(dataURL: string): Promise<LoadedModule> {
  return new Function('u', 'return import(u)')(dataURL);
}
