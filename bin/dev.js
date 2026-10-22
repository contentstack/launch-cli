#!/usr/bin/env node_modules/.bin/ts-node
(async () => {
  const oclif = await import('@oclif/core');
  const { handleStandaloneFailure } = require('../dist/core/failure');

  process.env.NODE_ENV = 'development';
  oclif.settings.debug = true;

  await oclif
    .run(process.argv.slice(2), __dirname)
    .then(() => oclif.flush())
    .catch(handleStandaloneFailure);
})();
