import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import { isAbsent } from '../core/values';
import { UploadFailedError } from './project.errors';
import type { SignedUploadField, SignedUploadUrl } from './types';

export const UPLOAD_FILE_NAME = 'project.zip';
export const UPLOAD_CONTENT_TYPE = 'application/zip';

export interface PreparedUpload {
  method: string;
  headers: Record<string, string>;
  body: Buffer;
}

function pairs(fields: SignedUploadField[] | undefined): [string, string][] {
  return (fields ?? [])
    .filter((field) => typeof field.key === 'string' && field.key !== '')
    .map((field) => [field.key as string, field.value ?? ''] as [string, string]);
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
  const supplied = pairs(target.headers);
  const headers: Record<string, string> = {};

  for (const [key, value] of supplied) {
    headers[key.toLowerCase()] = value;
  }

  const fields = pairs(target.fields);

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

export function uploadArchive(target: SignedUploadUrl, archive: Buffer): Promise<void> {
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

    request.end(prepared.body);
  });
}
