import { randomBytes } from 'node:crypto';
import type { ClientRequest } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import { UsageError } from '../core/errors';
import { isAbsent } from '../core/values';
import { UploadFailedError } from './project.errors';
import type { SignedUploadFormField, SignedUploadHeader, SignedUploadUrl } from './types';

export const UPLOAD_FILE_NAME = 'project.zip';
export const UPLOAD_CONTENT_TYPE = 'application/zip';
export const UPLOAD_IDLE_TIMEOUT_MS = 120_000;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MIN_UPLOAD_BYTES = 1024;
export const UPLOAD_CHUNK_BYTES = 256 * 1024;

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Every storage provider Launch uploads to enforces the same 1 KB - 100 MB range (management-service's
 * MIN_FILE_SIZE_BYTES / MAX_FILE_SIZE_BYTES). Checking it here refuses a bad zip before it is uploaded,
 * where the storage provider would only answer with a bare HTTP refusal.
 */
export function refuseArchiveOutsideLimits(bytes: number): void {
  if (bytes < MIN_UPLOAD_BYTES) {
    throw new UsageError(
      `Your project files zip to ${(bytes / BYTES_PER_KB).toFixed(1)} KB, under the ` +
        `${MIN_UPLOAD_BYTES / BYTES_PER_KB} KB Launch accepts for a file upload. ` +
        'Pass --data-dir with the folder holding your site\'s files.',
    );
  }

  if (bytes <= MAX_UPLOAD_BYTES) {
    return;
  }

  throw new UsageError(
    `Your project files zip to ${(bytes / BYTES_PER_MB).toFixed(1)} MB, over the ` +
      `${MAX_UPLOAD_BYTES / BYTES_PER_MB} MB Launch accepts for a file upload. ` +
      'Pass --data-dir with a folder holding only the files to deploy.',
  );
}

export interface PreparedUpload {
  method: string;
  headers: Record<string, string>;
  body: Buffer;
}

function named(entries: [string | undefined, string | undefined][]): [string, string][] {
  return entries
    .filter(([name]) => typeof name === 'string' && name !== '')
    .map(([name, value]) => [name as string, value ?? ''] as [string, string]);
}

function headerPairs(headers: SignedUploadHeader[] | null | undefined): [string, string][] {
  return named((headers ?? []).map((header) => [header.key, header.value]));
}

function formFieldPairs(fields: SignedUploadFormField[] | null | undefined): [string, string][] {
  return named((fields ?? []).map((field) => [field.formFieldKey, field.formFieldValue]));
}

function multipart(fields: [string, string][], archive: Buffer): { boundary: string; body: Buffer } {
  const boundary = `----launchcli${randomBytes(16).toString('hex')}`;
  const parts: Buffer[] = [];

  for (const [key, value] of fields) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${UPLOAD_FILE_NAME}"\r\n` +
        `Content-Type: ${UPLOAD_CONTENT_TYPE}\r\n\r\n`,
    ),
    archive,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  return { boundary, body: Buffer.concat(parts) };
}

export function prepareUpload(target: SignedUploadUrl, archive: Buffer): PreparedUpload {
  const supplied = headerPairs(target.headers);
  const headers: Record<string, string> = {};

  for (const [key, value] of supplied) {
    headers[key.toLowerCase()] = value;
  }

  const fields = formFieldPairs(target.fields);

  if (fields.length === 0) {
    if (isAbsent(headers['content-type'])) {
      headers['content-type'] = UPLOAD_CONTENT_TYPE;
    }

    headers['content-length'] = String(archive.length);

    return { method: target.method ?? 'PUT', headers, body: archive };
  }

  const form = multipart(fields, archive);
  headers['content-type'] = `multipart/form-data; boundary=${form.boundary}`;
  headers['content-length'] = String(form.body.length);

  return { method: target.method ?? 'POST', headers, body: form.body };
}

export type UploadProgress = (sent: number, total: number) => void;

export interface UploadOptions {
  idleTimeoutMs?: number;
  chunkBytes?: number;
  onProgress?: UploadProgress;
}

function sendBody(request: ClientRequest, body: Buffer, chunkBytes: number, report: UploadProgress): void {
  let offset = 0;

  report(offset, body.length);

  const next = (): void => {
    if (offset >= body.length) {
      request.end();
      return;
    }

    const end = Math.min(offset + chunkBytes, body.length);
    const chunk = body.subarray(offset, end);
    offset = end;
    request.write(chunk, () => {
      report(offset, body.length);
      next();
    });
  };

  next();
}

export function uploadArchive(target: SignedUploadUrl, archive: Buffer, options: UploadOptions = {}): Promise<void> {
  const idleTimeoutMs = options.idleTimeoutMs ?? UPLOAD_IDLE_TIMEOUT_MS;
  const chunkBytes = options.chunkBytes ?? UPLOAD_CHUNK_BYTES;
  const report = options.onProgress ?? (() => undefined);
  const prepared = prepareUpload(target, archive);
  const url = new URL(target.uploadUrl);
  const send = url.protocol === 'http:' ? httpRequest : httpsRequest;

  return new Promise<void>((resolve, reject) => {
    const request = send(url, { method: prepared.method, headers: prepared.headers }, (response) => {
      response.resume();
      const status = Number(response.statusCode);

      if (status >= 200 && status < 300) {
        response.on('end', resolve);
        return;
      }

      reject(new UploadFailedError(`The upload of your project files was refused with HTTP ${status}.`));
    });

    request.on('error', (error: Error) => {
      reject(new UploadFailedError(`The upload of your project files failed: ${error.message}`));
    });

    request.setTimeout(idleTimeoutMs, () => {
      reject(
        new UploadFailedError(
          `The upload of your project files stalled: nothing was sent or received for ${idleTimeoutMs / 1000} seconds.`,
        ),
      );
      request.destroy();
    });

    sendBody(request, prepared.body, chunkBytes, report);
  });
}
