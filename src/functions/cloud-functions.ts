import { parse as parseCookieHeader } from 'cookie';
import dotenv from 'dotenv';
import type {
  NextFunction,
  Request,
  Response,
} from 'express';
import express from 'express';
import type { Express } from 'express-serve-static-core';
import { realpathSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import type { Plugin } from 'rollup';

import { styled } from '../core/style';
import { isRecord } from '../core/values';
import { CloudFunctionsValidator } from './cloud-functions-validator';
import {
  CLOUD_FUNCTIONS_DIRECTORY,
  CLOUD_FUNCTIONS_SUPPORTED_EXTENSION,
  DYNAMIC_ROUTE_SEGMENT,
  ENV_FILE_NAME,
} from './constants';
import { FunctionsDirectoryNotFoundError, PortInUseError } from './function.errors';
import { walkFileSystem, checkIfDirectoryExists } from './os-helper';
import type { CloudFunctionResource } from './types';

type CloudFunctionHandler = CloudFunctionResource['handler'];

const DEPLOYED_PAYLOAD_LIMIT = '6mb';

function isHandler(value: unknown): value is CloudFunctionHandler {
  return typeof value === 'function';
}

export type ImportersById = Map<string, readonly string[]>;

function recordImporters(importersById: ImportersById): Plugin {
  return {
    name: 'launch-record-importers',
    buildEnd() {
      for (const moduleId of this.getModuleIds()) {
        const moduleInfo = this.getModuleInfo(moduleId);
        if (moduleInfo) {
          importersById.set(moduleId, [...moduleInfo.importers, ...moduleInfo.dynamicImporters]);
        }
      }
    },
  };
}

export function functionFilesImporting(
  moduleId: string,
  importersById: ImportersById,
  functionsDirectory: string,
  visited = new Set<string>(),
): string[] {
  return (importersById.get(moduleId) ?? []).flatMap((importer) => {
    if (path.isAbsolute(importer) && !isOutsideDirectory(functionsDirectory, importer)) {
      return [importer];
    }

    if (visited.has(importer)) {
      return [];
    }

    visited.add(importer);
    return functionFilesImporting(importer, importersById, functionsDirectory, visited);
  });
}

class OutsideImportReporter {
  private readonly reported = new Set<string>();

  constructor(
    private readonly projectDirectory: string,
    private readonly functionsDirectory: string,
  ) {}

  report(importersById: ImportersById): void {
    [...importersById.keys()]
      .filter((moduleId) => path.isAbsolute(moduleId))
      .filter((moduleId) => isOutsideDirectory(this.functionsDirectory, moduleId))
      .filter((moduleId) => !moduleId.split(path.sep).includes('node_modules'))
      .forEach((outsideFile) => {
        functionFilesImporting(outsideFile, importersById, this.functionsDirectory).forEach((importer) => {
          this.warnOnce(importer, outsideFile);
        });
      });
  }

  private warnOnce(importer: string, outsideFile: string): void {
    const pair = `${importer}\0${outsideFile}`;
    if (this.reported.has(pair)) {
      return;
    }

    this.reported.add(pair);
    const importerPath = path.relative(this.projectDirectory, importer);
    const outsidePath = path.relative(this.projectDirectory, outsideFile);
    const warning =
      `warn: ${importerPath} imports ${outsidePath}, ` +
      `which is outside ${CLOUD_FUNCTIONS_DIRECTORY}/ and will not be available when deployed.`;
    console.log(styled(warning, 'yellow', process.stdout.isTTY === true));
  }
}

export function isOutsideDirectory(directory: string, file: string, pathApi: path.PlatformPath = path): boolean {
  const relativePath = pathApi.relative(directory, file);
  return relativePath === '..' || relativePath.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relativePath);
}

function attachCookies(request: Request, _response: Response, next: NextFunction): void {
  request.cookies = request.headers.cookie ? parseCookieHeader(request.headers.cookie) : {};
  next();
}

function defaultToNoStore(_request: Request, response: Response, next: NextFunction): void {
  if (!response.getHeader('cache-control')) {
    response.setHeader('cache-control', 'no-store');
  }
  next();
}

function applyRequestMiddleware(app: Express): void {
  app.use(attachCookies);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.text({ limit: DEPLOYED_PAYLOAD_LIMIT }));
  app.use(express.raw({ limit: DEPLOYED_PAYLOAD_LIMIT }));
  app.use(defaultToNoStore);
}

import { loadDataURL } from './load-data-url';

export function listenFailure(error: NodeJS.ErrnoException, servingPort: number): Error {
  return error.code === 'EADDRINUSE' ? new PortInUseError(servingPort) : error;
}

export class CloudFunctions {
  private cloudFunctionsDirectoryPath: string;
  private pathToSourceCode: string;

  constructor(pathToSourceCode: string) {
    this.cloudFunctionsDirectoryPath = path.join(
      pathToSourceCode.replace(/^(\.\.(\/|\\|$))+/, ''),
      CLOUD_FUNCTIONS_DIRECTORY
    );
    this.pathToSourceCode = pathToSourceCode;
  }

  async serve(servingPort: number): Promise<Server | undefined> {
    const directoryExists = checkIfDirectoryExists(
      this.cloudFunctionsDirectoryPath
    );
    if (!directoryExists) {
      throw new FunctionsDirectoryNotFoundError(this.pathToSourceCode);
    }
    dotenv.config({ path: path.join(this.pathToSourceCode, ENV_FILE_NAME) });

    const cloudFunctionResources = await this.parseCloudFunctionResources();

    const hasCloudFunctionResources = cloudFunctionResources.length;
    if (!hasCloudFunctionResources) {
      console.log('No Serverless functions detected.');
      return;
    }

    const cloudFunctionsValidator = new CloudFunctionsValidator(
      cloudFunctionResources
    );
    const error = cloudFunctionsValidator.validate();
    if (error) {
      throw error;
    }
    const { exactRouteResources, dynamicRouteResources } =
      this.transformAndSegregateResourcesByRoutes(cloudFunctionResources);

    const app = express();
    app.disable('x-powered-by');
    applyRequestMiddleware(app);
    this.applyAppRouter(exactRouteResources, app);
    this.applyAppRouter(dynamicRouteResources, app);

    return this.startServer(app, servingPort, [
      ...exactRouteResources,
      ...dynamicRouteResources,
    ]);
  }

  private printServing(
    servingPort: number,
    cloudFunctionResources: CloudFunctionResource[]
  ): void {
    console.log('Detected Serverless Functions:');
    cloudFunctionResources.forEach(({ apiResourceURI }) => {
      console.log(`  λ ${apiResourceURI}`);
    });
    console.log('');
    const url = styled(`http://localhost:${servingPort}`, 'cyan', process.stdout.isTTY === true);
    console.log(`Serving Cloud Functions at ${url}`);
  }

  private startServer(
    app: Express,
    servingPort: number,
    cloudFunctionResources: CloudFunctionResource[]
  ): Promise<Server> {
    return new Promise<Server>((resolve, reject) => {
      const refuse = (error: NodeJS.ErrnoException): void => {
        reject(listenFailure(error, servingPort));
      };

      const server = app.listen(servingPort, () => {
        server.off('error', refuse);
        this.printServing((server.address() as AddressInfo).port, cloudFunctionResources);
        resolve(server);
      });

      server.once('error', refuse);
    });
  }

  private applyAppRouter(cloudFunctionResources: CloudFunctionResource[], app: Express): void {
    cloudFunctionResources.forEach((cloudFunctionResource) => {
      app.all(cloudFunctionResource.apiResourceURI, async (request: Request, response: Response) => {
        try {
          await cloudFunctionResource.handler(request, response);
        } catch (error) {
          console.error(error);
          response.status(500).send();
        }
      });
    });
  }

  private isProxyEdgeFile(filename: string): boolean {
    const PROXY_EDGE_FILENAME = '[proxy].edge.js';
    return filename === PROXY_EDGE_FILENAME;
  }

  private async parseCloudFunctionResources(): Promise<
    CloudFunctionResource[]
    > {
    const filePaths = await walkFileSystem(this.cloudFunctionsDirectoryPath);
    const outsideImports = new OutsideImportReporter(
      realpathSync(this.pathToSourceCode),
      realpathSync(this.cloudFunctionsDirectoryPath),
    );

    const cloudFunctionResources: CloudFunctionResource[] = [];
    for await (const filePath of filePaths) {
      const parsedPath = path.parse(filePath);

      if (this.isProxyEdgeFile(parsedPath.base)
        || parsedPath.ext !== CLOUD_FUNCTIONS_SUPPORTED_EXTENSION
      ) {
        continue;
      }

      const handler = await this.buildHandlerForFilepath(filePath, outsideImports);
      if (!handler) {
        continue;
      }

      const relativeParsedPath = path.parse(
        path.relative(this.cloudFunctionsDirectoryPath, filePath)
      );

      const apiResourceURI = `/${path.join(
        relativeParsedPath.dir,
        relativeParsedPath.name
      )}`;

      cloudFunctionResources.push({
        cloudFunctionFilePath: filePath,
        apiResourceURI,
        handler
      });
    }

    return cloudFunctionResources;
  }

  private transformAndSegregateResourcesByRoutes(
    cloudFunctionResources: CloudFunctionResource[]
  ): {
    exactRouteResources: CloudFunctionResource[];
    dynamicRouteResources: CloudFunctionResource[];
  } {
    const exactRouteResources: CloudFunctionResource[] = [];
    const dynamicRouteResources: CloudFunctionResource[] = [];

    cloudFunctionResources.forEach(
      (cloudFunctionResource: CloudFunctionResource) => {
        if (
          cloudFunctionResource.apiResourceURI.match(DYNAMIC_ROUTE_SEGMENT) !==
          null
        ) {
          const apiResourceURI = cloudFunctionResource.apiResourceURI.replace(
            DYNAMIC_ROUTE_SEGMENT,
            ':$1'
          );

          dynamicRouteResources.push({
            ...cloudFunctionResource,
            apiResourceURI,
          });
        } else {
          exactRouteResources.push(cloudFunctionResource);
        }
      }
    );

    return { exactRouteResources, dynamicRouteResources };
  }

  private async buildHandlerForFilepath(
    cloudFunctionFilePath: string,
    outsideImports: OutsideImportReporter,
  ): Promise<CloudFunctionHandler | null> {
    const [{ rollup }, { nodeResolve }, { default: commonjs }, { default: json }] = await Promise.all([
      import('rollup'),
      import('@rollup/plugin-node-resolve'),
      import('@rollup/plugin-commonjs'),
      import('@rollup/plugin-json'),
    ]);
    const importersById: ImportersById = new Map();
    const bundle = await rollup({
      input: cloudFunctionFilePath,
      plugins: [nodeResolve({ preferBuiltins: true }), commonjs(), json(), recordImporters(importersById)],
    });
    outsideImports.report(importersById);

    const { output } = await bundle.generate({
      format: 'esm',
      inlineDynamicImports: true,
    });

    const builtCode = output[0].code;

    const builtCodeInDataURLFormat =
      'data:text/javascript;base64,' + Buffer.from(builtCode).toString('base64');

    const module = await loadDataURL(builtCodeInDataURLFormat);

    const exported = module.default;

    if (isHandler(exported)) {
      return exported;
    }

    if (isRecord(exported) && isHandler(exported.default)) {
      return exported.default;
    }

    return null;
  }
}
