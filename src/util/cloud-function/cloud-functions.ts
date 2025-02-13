import dotenv from 'dotenv';
import express, {
  Request,
  Response,
} from 'express';
import { Express } from 'express-serve-static-core';
import path from "path";

import { CloudFunctionsValidator } from "./cloud-functions-validator";
import {
  CLOUD_FUNCTIONS_DIRECTORY,
  CLOUD_FUNCTIONS_SUPPORTED_EXTENSION,
  ENV_FILE_NAME,
} from "./constants";
import { FunctionsDirectoryNotFoundError } from "./errors/cloud-function.errors";
import { walkFileSystem, checkIfDirectoryExists } from "./os-helper";
import { CloudFunctionResource } from "./types";

import rollup from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { loadDataURL } from './load-data-url';

export class CloudFunctions {
  private cloudFunctionsDirectoryPath: string;
  private pathToSourceCode: string;

  constructor(pathToSourceCode: string) {
    this.cloudFunctionsDirectoryPath = path.join(
      pathToSourceCode.replace(/^(\.\.(\/|\\|$))+/, ""),
      CLOUD_FUNCTIONS_DIRECTORY
    );
    this.pathToSourceCode = pathToSourceCode;
  }

  async serve(servingPort: number): Promise<void> {
    const directoryExists = checkIfDirectoryExists(
      this.cloudFunctionsDirectoryPath
    );
    if (!directoryExists) {
      throw new FunctionsDirectoryNotFoundError(this.pathToSourceCode);
    }
    const cloudFunctionResources = await this.parseCloudFunctionResources();

    const hasCloudFunctionResources = cloudFunctionResources.length;
    if (!hasCloudFunctionResources) {
      console.log("No Serverless functions detected.");
      process.exit(0);
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

    await this.applyAppRouter(exactRouteResources, app);
    await this.applyAppRouter(dynamicRouteResources, app);

    dotenv.config({ path: path.join(this.pathToSourceCode, ENV_FILE_NAME) });

    app.listen(servingPort, () => {
      console.log(`Serving on port ${servingPort}`);
    });
  }

  private async applyAppRouter(
    cloudFunctionResources: CloudFunctionResource[],
    app: Express
  ): Promise<void> {
    await Promise.all(
      cloudFunctionResources.map(async (cloudFunctionResource) => {

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        app.use((request: Request, response: Response, next) => {
          if (!response.getHeader('cache-control')) {
            response.setHeader('cache-control', 'no-store');
          }
          next();
        });
        
        app.all(
          cloudFunctionResource.apiResourceURI,
          async (request: Request, response: Response) => {
            try {
              return await cloudFunctionResource.handler(request, response);
            } catch (error) {
              console.error(error);
              response.status(500).send();
            }
          }
        );
      })
    );
  }

  private isProxyEdgeFile(filename: string): boolean {
    const PROXY_EDGE_FILENAME = '[proxy].edge.js';
    return filename === PROXY_EDGE_FILENAME;
  }

  private async parseCloudFunctionResources(): Promise<
    CloudFunctionResource[]
  > {
    const filePaths = await walkFileSystem(this.cloudFunctionsDirectoryPath);

    const cloudFunctionResources: CloudFunctionResource[] = [];
    for await (const filePath of filePaths) {
      const parsedPath = path.parse(filePath);

      if (this.isProxyEdgeFile(parsedPath.base)
        || parsedPath.ext !== CLOUD_FUNCTIONS_SUPPORTED_EXTENSION
      ) {
        continue;
      }

      const handler = await this.buildHandlerForFilepath(filePath);
      if(!handler) {
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
    const matchDyanmicRouteRegex = /\[(.*?)\]/g;
    const exactRouteResources: CloudFunctionResource[] = [];
    const dynamicRouteResources: CloudFunctionResource[] = [];

    if (cloudFunctionResources.length) {
      console.log("Detected Serverless functions...");
    }

    cloudFunctionResources.forEach(
      (cloudFunctionResource: CloudFunctionResource) => {
        if (
          cloudFunctionResource.apiResourceURI.match(matchDyanmicRouteRegex) !==
          null
        ) {
          const apiResourceURI = cloudFunctionResource.apiResourceURI.replace(
            matchDyanmicRouteRegex,
            ":$1"
          );

          dynamicRouteResources.push({
            ...cloudFunctionResource,
            apiResourceURI,
          });
          console.log(`λ ${apiResourceURI} \n`);
        } else {
          exactRouteResources.push(cloudFunctionResource);
          console.log(`λ ${cloudFunctionResource.apiResourceURI} \n`);
        }
      }
    );

    return { exactRouteResources, dynamicRouteResources };
  }

  private async buildHandlerForFilepath(cloudFunctionFilePath: string) {
    const bundle = await rollup.rollup({
      input: cloudFunctionFilePath,
      plugins: [nodeResolve({ preferBuiltins: true }), commonjs(), json()],
    });
  
    const { output } = await bundle.generate({
      format: "esm",
      inlineDynamicImports: true,
    });
  
    const builtCode = output[0].code;
  
    const builtCodeInDataURLFormat =
      "data:text/javascript;base64," + Buffer.from(builtCode).toString("base64");
  
    const module = await loadDataURL(builtCodeInDataURLFormat);
    
    let handler = null;
    const isDefaultExportESModuleFunction = typeof module.default === 'function';
    const isDefaultExportCommonjsFunction = typeof module.default?.default === 'function';
    if (isDefaultExportESModuleFunction) {
        handler = module.default;
    }
    else if (isDefaultExportCommonjsFunction) {
        handler = module.default.default;
    }

    return handler;
  }
}
