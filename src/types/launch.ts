import EventEmitter from 'events';
import { ApolloClient } from '@apollo/client/core';
import { ContentstackClient, FlagInput, PrintOptions } from '@contentstack/cli-utilities';

import config from '../config';
import { LoggerType } from './utils';

type Providers = 'GitHub' | 'FileUpload';

enum FileUploadMethod {
  LastFileUpload = 'last file upload',
  NewFile = 'new file',
}

type LogFn = (message: string | any, logType?: LoggerType | PrintOptions | undefined) => void;

type ExitFn = (code?: number | undefined) => void;

type AdapterConstructorInputs = {
  log?: LogFn;
  exit?: ExitFn;
  config: ConfigType;
  $event: EventEmitter;
  analyticsInfo: string;
  apolloClient: ApolloClient<any>;
  apolloLogsClient?: ApolloClient<any>;
  managementSdk?: ContentstackClient;
};

type Partial<T> = {
  [P in keyof T]?: T[P];
};

type ConfigType = {
  cwd?: string;
  host: string;
  branch?: string;
  config: string;
  authType: string;
  flags: FlagInput;
  framework?: string;
  authtoken?: string;
  deployment?: string;
  environment?: string;
  stackEnvironment?: string;
  provider?: Providers;
  fileUploadMethod?: FileUploadMethod;
  authorization?: string;
  logsApiBaseUrl: string;
  projectBasePath: string;
  manageApiBaseUrl: string;
  isExistingProject?: boolean;
  repository?: Record<string, any>;
  currentConfig: Record<string, any>;
  deliveryToken?: Record<string, any>;
} & typeof config &
  Record<string, any>;

type GraphqlHeaders = {
  'X-CS-CLI': string;
  authtoken?: string;
  'x-cs-cli-id'?: any;
  authorization?: string;
  'x-project-uid'?: string;
  organization_uid?: string;
} & Record<string, any>;

type GraphqlApiClientInput = {
  cmaHost?: string;
  baseUrl: string;
  headers?: GraphqlHeaders;
};

type FormField = {
  formFieldKey: string;
  formFieldValue: string;
};
type SignedUploadUrlData = {
  uploadUrl: string;
  fields: FormField[];
  headers: { key: string; value: string }[];
  method: string;
  uploadUid: string;
};

export type Environment = {
  uid: string;
  name: string;
  frameworkPreset: string;
};

export enum DeploymentStatus {
  QUEUED = 'QUEUED',
  LIVE = 'LIVE',
  DEPLOYED = 'DEPLOYED',
  ARCHIVED = 'ARCHIVED',
  DEPLOYING = 'DEPLOYING',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum VariablePreparationTypeOptions {
  IMPORT_FROM_STACK = 'Import variables from a stack',
  ADD_MANUALLY = 'Manually add custom variables to the list',
  IMPORT_FROM_LOCAL_FILE = 'Import variables from the .env.local file',
  SKIP_SETUP = 'Skip adding environment variables',
}

export {
  LogFn,
  ExitFn,
  Partial,
  Providers,
  ConfigType,
  AdapterConstructorInputs,
  GraphqlHeaders,
  GraphqlApiClientInput,
  SignedUploadUrlData,
  FileUploadMethod,
};
