export const PREPARING_ARCHIVE = 'Preparing zip file...';

export const UPLOAD_PROGRESS_LABEL = 'Uploading project.zip';

export function skippedLinksLine(skippedLinks: readonly string[]): string {
  return `Skipping ${skippedLinks.length} symbolic link(s), which are never uploaded: ${skippedLinks.join(', ')}`;
}
