import { VariablePreparationTypeOptions } from '../types';

const config = {
  maxRetryCount: 3,
  configName: '.cs-launch.json',
  logsApiEndpoint: 'logs/graphql',
  manageApiEndpoint: 'manage/graphql',
  projectCreationRetryMaxCount: 3,
  fileUploadConfig: {
    exclude: ['logs', '.next', 'node_modules', '.cs-launch.json', '.git', '.env', '.env.local', '.vscode'],
  },
  outputDirectories: {
    GATSBY: './public',
    NEXTJS: './.next',
    CRA: './build',
    CSR: './',
    ANALOG: './dist/analog/public',
    ANGULAR: './dist',
    NUXT: './.output',
    ASTRO: './dist',
    VUEJS: './dist',
    REMIX: './build',
    OTHER: './',
  },
  listOfFrameWorks: [
    { name: 'Gatsby', value: 'GATSBY' },
    { name: 'NextJs', value: 'NEXTJS' },
    { name: 'CRA (Create React App)', value: 'CRA' },
    { name: 'CSR (Client-Side Rendered)', value: 'CSR' },
    { name: 'Analog', value: 'ANALOG' },
    { name: 'Angular', value: 'ANGULAR' },
    { name: 'Nuxt', value: 'NUXT' },
    { name: 'Astro', value: 'ASTRO' },
    { name: 'VueJs', value: 'VUEJS' },
    { name: 'Remix', value: 'REMIX' },
    { name: 'Other', value: 'OTHER' },
  ],
  providerMapper: {
    GITPROVIDER: 'GitHub',
    FILEUPLOAD: 'FileUpload',
  },
  launchHubUrls: '',
  launchBaseUrl: '',
  supportedAdapters: ['GitHub'],
  deploymentStatus: ['LIVE', 'FAILED', 'SKIPPED', 'DEPLOYED'],
  pollingInterval: 1000,
  variablePreparationTypeOptions: [
    VariablePreparationTypeOptions.IMPORT_FROM_STACK,
    VariablePreparationTypeOptions.ADD_MANUALLY,
    VariablePreparationTypeOptions.IMPORT_FROM_LOCAL_FILE,
    VariablePreparationTypeOptions.SKIP_SETUP,
  ],
  variableType: '',
  supportedFrameworksForServerCommands: ['ANALOG', 'ANGULAR', 'OTHER', 'REMIX', 'NUXT', 'ASTRO'],
  supportedFrameworksForServerCommands: ['ANGULAR', 'OTHER', 'REMIX', 'NUXT', 'ASTRO'],
  supportedFileUploadMethods: ['last file upload', 'new file']

};

export default config;
