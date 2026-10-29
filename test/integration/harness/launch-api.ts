import AdmZip from 'adm-zip';
import express from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';

export type Endpoint = 'manage' | 'logs';

export type RecordedOperation = {
  endpoint: Endpoint;
  operationName: string;
  variables: Record<string, any>;
  headers: Record<string, string>;
};

export type RecordedUpload = {
  method: string;
  path: string;
  contentType?: string;
  byteLength: number;
  body: Buffer;
};

export type GraphqlResult = { data?: Record<string, any>; errors?: Record<string, any>[] };

export type Responder = (variables: Record<string, any>, callIndex: number) => GraphqlResult;

const asResponder = (value: GraphqlResult | Responder): Responder =>
  typeof value === 'function' ? value : () => value;

export class LaunchApiMock {
  private server?: Server;
  private port = 0;
  private responders = new Map<string, Responder>();
  private operations: RecordedOperation[] = [];
  private uploads: RecordedUpload[] = [];
  private unhandled: string[] = [];

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    const app = express();
    app.use(express.json({ limit: '50mb' }));

    app.post('/manage/graphql', (req, res) => this.handleGraphql('manage', req, res));
    app.post('/logs/graphql', (req, res) => this.handleGraphql('logs', req, res));

    const recordUpload = (req: express.Request): void => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      this.uploads.push({
        method: req.method,
        path: req.path,
        contentType: req.get('content-type'),
        byteLength: body.length,
        body,
      });
    };

    app.put('/upload/*', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
      recordUpload(req);
      res.status(200).json({ ok: true });
    });

    app.post('/upload/*', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
      recordUpload(req);
      res.status(204).end();
    });

    await new Promise<void>((resolve) => {
      this.server = app.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => this.server!.close((error) => (error ? reject(error) : resolve())));
    this.server = undefined;
  }

  reset(): void {
    this.responders.clear();
    this.operations = [];
    this.uploads = [];
    this.unhandled = [];
  }

  on(operationName: string, response: GraphqlResult | Responder): this {
    this.responders.set(operationName, asResponder(response));
    return this;
  }

  calls(operationName?: string): RecordedOperation[] {
    return operationName
      ? this.operations.filter((operation) => operation.operationName === operationName)
      : [...this.operations];
  }

  operationSequence(): string[] {
    return this.operations
      .map((operation) => operation.operationName)
      .filter((name, index, names) => name !== names[index - 1]);
  }

  variablesOf(operationName: string, callIndex = 0): Record<string, any> {
    const call = this.calls(operationName)[callIndex];
    if (!call) {
      throw new Error(
        `The CLI never sent the GraphQL operation "${operationName}"` +
          `${callIndex ? ` (call #${callIndex})` : ''}. Operations sent: ${
            this.operationSequence().join(' -> ') || '(none)'
          }`,
      );
    }
    return call.variables;
  }

  headersOf(operationName: string, callIndex = 0): Record<string, string> {
    const call = this.calls(operationName)[callIndex];
    if (!call) {
      throw new Error(`The CLI never sent the GraphQL operation "${operationName}".`);
    }
    return call.headers;
  }

  uploadedFiles(): RecordedUpload[] {
    return [...this.uploads];
  }

  uploadedZipEntries(uploadIndex = 0): string[] {
    const upload = this.uploads[uploadIndex];
    if (!upload) {
      throw new Error(`The CLI did not upload a file (upload #${uploadIndex}).`);
    }
    return new AdmZip(upload.body)
      .getEntries()
      .map((entry) => entry.entryName)
      .sort();
  }

  unhandledOperations(): string[] {
    return [...new Set(this.unhandled)];
  }

  assertNoUnhandledOperations(): void {
    if (!this.unhandled.length) return;
    throw new Error(
      `The CLI sent GraphQL operations this test did not stub: ${this.unhandledOperations().join(', ')}.\n` +
        `Full operation sequence: ${this.operationSequence().join(' -> ')}`,
    );
  }

  private handleGraphql(endpoint: Endpoint, req: express.Request, res: express.Response): void {
    const { operationName, variables = {} } = req.body ?? {};
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value.join(',') : String(value ?? '');
    }

    const callIndex = this.operations.filter((operation) => operation.operationName === operationName).length;
    this.operations.push({ endpoint, operationName, variables, headers });

    const responder = this.responders.get(operationName);
    if (!responder) {
      this.unhandled.push(operationName);
      res.status(200).json({
        errors: [{ message: `No mock registered for GraphQL operation "${operationName}"` }],
      });
      return;
    }

    res.status(200).json(responder(variables, callIndex));
  }
}
