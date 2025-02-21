// The tsc compiler currently compiles to "commonjs" output as per the tsconfig.
// As a result, the use of dynamic import "import()" in the cloud-function logic, gets replaced with "require()" in the dist/ output. 
// "require()" however does not support importing modules from data url strings causing this logic to break.
// Therefore, we patch the dist/ output to again use dynamic imports "import()" after tsc compilation.

const rollup = require('rollup');
const typescript = require('@rollup/plugin-typescript');
const path = require('path');

async function transpileTsFileToESM(inputFile, outputFile) {
  const bundle = await rollup.rollup({
    input: inputFile,
    plugins: [typescript({ module: 'esnext', declaration: false })],
  });

  await bundle.write({
    file: outputFile,
    format: 'commonjs',
    sourcemap: false,
  });
}

async function patchLoadDataURLFunction() {
  const loadDataURLInputFilePath = path.join(process.cwd(), 'src/util/cloud-function/load-data-url.ts');
  const loadDataURLOutputFilePath = path.join(process.cwd(), 'dist/util/cloud-function/load-data-url.js');
  await transpileTsFileToESM(loadDataURLInputFilePath, loadDataURLOutputFilePath);
  console.log(`${loadDataURLInputFilePath} : File patched successfully`);
}

patchLoadDataURLFunction();
