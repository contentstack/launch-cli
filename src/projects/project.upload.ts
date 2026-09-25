import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import { isAbsent } from '../core/values';
import { UploadFailedError } from './project.errors';
import type { SignedUploadFormField, SignedUploadHeader, SignedUploadUrl } from './types';

export const UPLOAD_FILE_NAME = 'project.zip';
export const UPLOAD_CONTENT_TYPE = 'application/zip';
export const UPLOAD_IDLE_TIMEOUT_MS = 120_000;

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

export function uploadArchive(
  target: SignedUploadUrl,
  archive: Buffer,
  idleTimeoutMs = UPLOAD_IDLE_TIMEOUT_MS,
): Promise<void> {
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

    request.end(prepared.body);
  });
}
