import type { Progress } from '../core/progress';
import { silentProgress, terminalProgress } from '../core/progress';
import type { ServiceContext } from '../core/service-context';
import { archiveDirectory } from './upload.archive';
import { PREPARING_ARCHIVE, UPLOAD_PROGRESS_LABEL, skippedLinksLine } from './upload.presenter';
import { refuseArchiveOutsideLimits, uploadArchive } from './upload.transfer';
import type { SignedUploadUrl } from './types';

export class FolderUploader {
  constructor(private readonly services: ServiceContext) {}

  async upload(org: string, folder: string, excludedFiles: readonly string[] = []): Promise<string> {
    this.services.ux.print(PREPARING_ARCHIVE);
    const archive = archiveDirectory(folder, excludedFiles);
    refuseArchiveOutsideLimits(archive.buffer.length);

    if (archive.skippedLinks.length > 0) {
      this.services.ux.print(skippedLinksLine(archive.skippedLinks));
    }

    const signed = await this.services.api.uploads.signedUploadUrl({ org });
    await this.uploading(signed, archive.buffer);

    return signed.uploadUid;
  }

  private async uploading(signed: SignedUploadUrl, body: Buffer): Promise<void> {
    const progress = this.progress();

    try {
      await uploadArchive(signed, body, {
        onProgress: (sent, total) => {
          progress.start(total);
          progress.advance(sent);
        },
      });
    } finally {
      progress.stop();
    }
  }

  private progress(): Progress {
    return this.services.outputIsTTY === true ? terminalProgress(UPLOAD_PROGRESS_LABEL) : silentProgress;
  }
}
