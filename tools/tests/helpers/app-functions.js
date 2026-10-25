'use strict';

const path = require('path');
const vm = require('vm');
const {readAppSource, extractFunctionSource} = require('../source');
const source = readAppSource(path.resolve(__dirname, '../../..'));

function loadAppFunctions(context, names) {
  vm.runInContext(names.map(name => extractFunctionSource(source, name)).join('\n'), context);
}
module.exports = {loadAppFunctions};
