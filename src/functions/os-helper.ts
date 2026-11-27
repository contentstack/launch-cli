import fs from 'fs';
import { join, normalize } from 'path';

export async function* walkFileSystem(directory: string): AsyncGenerator<string> {
  const fileSystemElements: fs.Dirent[] = [];
  for await (const fileSystemElement of await fs.promises.opendir(directory)) {
    fileSystemElements.push(fileSystemElement);
  }
  fileSystemElements.sort((left, right) => Number(left.name > right.name) - Number(left.name < right.name));

  for (const fileSystemElement of fileSystemElements) {
    const filePath = normalize(join(directory, fileSystemElement.name));

    if (fileSystemElement.isDirectory()) {
      yield* walkFileSystem(filePath);
    } else if (fileSystemElement.isFile()) {
      yield filePath;
    }
  }
}

export function checkIfDirectoryExists(directoryPath: string): boolean {
  return fs.existsSync(directoryPath);
}
