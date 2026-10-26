#!/usr/bin/env node_modules/.bin/ts-node
(async () => {
  const oclif = await import('@oclif/core');

  process.env.NODE_ENV = 'development';
  oclif.settings.debug = true;

  // The source handler loads only once ts-node is registered: always under the ts-node shebang, but under plain
  // `node bin/dev` only after oclif has loaded a TypeScript command. Fall back to the build, then to oclif.
  function failureHandler() {
    for (const path of ['../src/core/failure', '../dist/core/failure']) {
      try {
        return require(path).handleStandaloneFailure;
      } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') {
          throw error;
        }
      }
    }

    return oclif.Errors.handle;
  }

  await oclif
    .run(process.argv.slice(2), __dirname)
    .then(() => oclif.flush())
    .catch((err) => failureHandler()(err));
})();
