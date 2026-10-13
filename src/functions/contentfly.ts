import { isAbsolute, join, normalize } from 'path';

import { CloudFunctions } from './cloud-functions';

export class Contentfly {
  private pathToSourceCode: string;
  private cloudFunctions: CloudFunctions;

  constructor(dirPath: string) {
    this.pathToSourceCode = isAbsolute(dirPath) ? dirPath : normalize(join(process.cwd(), dirPath));
    this.cloudFunctions = new CloudFunctions(this.pathToSourceCode);
  }

  async serveCloudFunctions(servingPort: number): Promise<void> {
    await this.cloudFunctions.serve(servingPort);
  }
}
