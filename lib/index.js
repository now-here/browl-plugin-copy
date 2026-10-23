'use strict';

const path = require('path');
const fse = require('fs-extra');
const browlUtil = require('browl-util');
const debug = require('debug')('browl-plugin-copy');

const UPDATE_MODES = ['never', 'missing'];

function toArray(value) {
  if (typeof value === 'undefined' || value === null || value === '') {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

/**
 * "source:destination" -> {source, destination}
 */
function parseFile(entry) {
  const index = String(entry).indexOf(':');
  const source = index === -1 ? '' : entry.slice(0, index).trim();
  const destination = index === -1 ? '' : entry.slice(index + 1).trim();

  if (!source || !destination) {
    throw new Error('browl-plugin-copy: "' + entry + '" is not "source:destination".');
  }

  if (path.isAbsolute(destination)) {
    throw new Error('browl-plugin-copy: destination "' + destination + '" must be relative to the instance directory.');
  }

  if (path.normalize(destination).split(path.sep).indexOf('..') !== -1) {
    throw new Error('browl-plugin-copy: destination "' + destination + '" must stay in the instance directory.');
  }

  return {source, destination};
}

function parseMode(value) {
  if (typeof value === 'undefined' || value === '') {
    return null;
  }

  if (!/^[0-7]{3,4}$/.test(String(value))) {
    throw new Error('browl-plugin-copy: mode "' + value + '" is not an octal number like 0640.');
  }

  return parseInt(value, 8);
}

function isInside(dir, file) {
  return file === dir || file.startsWith(dir + path.sep);
}

/**
  * Copy plugin copies files from the repo config directory to the instance work directory,
  * before the instance is created. It can also restore missing files when the instance is updated.
  *
  * @param {Object} strategy
  */
module.exports = (strategy) => {
  debug('init');

  const repo = strategy.repo;
  const rootConfig = strategy.rootConfig;

  if (!rootConfig || !strategy.repoConfig) {
    throw new Error('browl-plugin-copy: the deploy strategy must expose repo, rootConfig and repoConfig.');
  }

  const copyConfig = strategy.repoConfig.copy || {};

  const files = toArray(copyConfig.files).map(parseFile);
  const update = copyConfig.update || 'never';
  const mode = parseMode(copyConfig.mode);

  if (UPDATE_MODES.indexOf(update) === -1) {
    throw new Error('browl-plugin-copy: update "' + update + '" is not one of: ' + UPDATE_MODES.join(', ') + '.');
  }

  debug('files: %j, update: %s, mode: %s', files, update, mode);

  if (files.length === 0) {
    return strategy;
  }

  const originalCreate = strategy.create.bind(strategy);
  const originalUpdate = strategy.update ? strategy.update.bind(strategy) : null;

  function resolveSource(source) {
    return path.isAbsolute(source) ? source : path.join(rootConfig.conf_dir, repo, source);
  }

  async function copy(file, cwd, onlyMissing) {
    const source = resolveSource(file.source);
    const destination = path.resolve(cwd, file.destination);

    if (!await fse.pathExists(source)) {
      throw new Error('browl-plugin-copy: source file not found: ' + source);
    }

    // a branch is developer code: it may contain a symlink that leads out of the instance directory
    await fse.ensureDir(path.dirname(destination));

    const root = await fse.realpath(cwd);
    const parent = await fse.realpath(path.dirname(destination));
    if (!isInside(root, parent)) {
      throw new Error('browl-plugin-copy: destination ' + file.destination + ' leaves the instance directory.');
    }

    const stat = await fse.lstat(destination).catch(() => null);
    if (stat && stat.isSymbolicLink()) {
      throw new Error('browl-plugin-copy: refusing to write through a symlink: ' + file.destination);
    }

    if (stat && onlyMissing) {
      debug('%s exists, skip', file.destination);
      return;
    }

    await fse.copyFile(source, destination);

    if (mode !== null) {
      await fse.chmod(destination, mode);
    }

    browlUtil.log('[browl-plugin-copy] copied ' + file.source + ' -> ' + file.destination);
  }

  async function copyAll(cwd, onlyMissing) {
    for (const file of files) {
      await copy(file, cwd, onlyMissing);
    }
  }

  strategy.create = (branch, options) => {
    debug('create: %s', branch);

    return copyAll(options.cwd, false).then(() => originalCreate(branch, options));
  };

  if (update === 'missing' && originalUpdate) {
    strategy.update = (branch, options) => {
      debug('update: %s', branch);

      return copyAll(options.cwd, true).then(() => originalUpdate(branch, options));
    };
  }

  return strategy;
};
