'use strict';

const path = require('path');
const fs = require('fs');

const appDirectory = fs.realpathSync(process.cwd());

function resolveApp(relativePath) {
  return path.resolve(appDirectory, relativePath);
}

const paths = {
  src: resolveApp('src'),
  build: resolveApp('build'),
  nodeModules: resolveApp('node_modules'),
};

const config = {
  paths: paths,
  entries: {
    main: [paths.src + '/js/main.js', paths.src + '/sass/main.scss'],
    vendor: [paths.src + '/js/vendor.js'],
  }
};

module.exports = config;
