export function loadDataURL(dataURL: string): Promise<any> {
  return new Function('u', 'return import(u)')(dataURL);
}
