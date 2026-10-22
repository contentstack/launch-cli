#!/usr/bin/env node

(async () => {
  const oclif = await import('@oclif/core');
  const { handleStandaloneFailure } = require('../dist/core/failure');

  await oclif
    .run(process.argv.slice(2), __dirname)
    .then(() => oclif.flush())
    .catch(handleStandaloneFailure);
})();
