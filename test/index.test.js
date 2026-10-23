'use strict';

const fse = require('fs-extra');
const path = require('path');
const sinon = require('sinon');
const NullStrategy = require('browl-null');
const browlUtil = require('browl-util');
const copyPlugin = require('../');

describe('browl-plugin-copy', () => {
  const tmpDir = path.join(__dirname, '../tmp');
  const confDir = path.join(tmpDir, 'etc/browl');
  const cwd = path.join(tmpDir, 'www/feature-qa');
  const SECRET = '{"private_key": "not-for-logs"}';

  let sandbox;
  let repoConfig;
  let calls;
  let fileWhenCreated;

  function build(copy) {
    repoConfig = {copy};
    const strategy = new NullStrategy('webapp', {conf_dir: confDir}, repoConfig);

    strategy.create = () => {
      calls.push('create');
      fileWhenCreated = fse.existsSync(path.join(cwd, 'storage/firebase-dev.json'));
      return Promise.resolve();
    };
    strategy.update = () => {
      calls.push('update');
      return Promise.resolve();
    };

    return copyPlugin(strategy);
  }

  async function rejected(promise) {
    try {
      await promise;
    } catch (err) {
      return err;
    }

    return expect.fail('should have been rejected');
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(browlUtil, 'log');
    calls = [];

    fse.removeSync(tmpDir);
    fse.ensureDirSync(path.join(confDir, 'webapp/templates'));
    fse.ensureDirSync(cwd);
    fse.writeFileSync(path.join(confDir, 'webapp/templates/firebase-dev.json'), SECRET);
  });

  afterEach(() => {
    sandbox.restore();
    fse.removeSync(tmpDir);
  });

  describe('create', () => {
    it('should copy a file relative to the repo config into the instance directory', async () => {
      const strategy = build({files: ['./templates/firebase-dev.json:storage/firebase-dev.json']});

      await strategy.create('feature/qa', {cwd});

      expect(fse.readFileSync(path.join(cwd, 'storage/firebase-dev.json'), 'utf8')).equal(SECRET);
    });

    it('should copy before the instance is created', async () => {
      const strategy = build({files: ['./templates/firebase-dev.json:storage/firebase-dev.json']});

      await strategy.create('feature/qa', {cwd});

      expect(calls).eql(['create']);
      expect(fileWhenCreated).equal(true);
    });

    it('should accept an absolute source and several files', async () => {
      const absolute = path.join(tmpDir, 'other.txt');
      fse.writeFileSync(absolute, 'other');
      const strategy = build({
        files: [
          './templates/firebase-dev.json:storage/firebase-dev.json',
          absolute + ':config/other.txt'
        ]
      });

      await strategy.create('feature/qa', {cwd});

      expect(fse.readFileSync(path.join(cwd, 'storage/firebase-dev.json'), 'utf8')).equal(SECRET);
      expect(fse.readFileSync(path.join(cwd, 'config/other.txt'), 'utf8')).equal('other');
    });

    it('should accept a single file that is not a list', async () => {
      const strategy = build({files: './templates/firebase-dev.json:storage/firebase-dev.json'});

      await strategy.create('feature/qa', {cwd});

      expect(fse.existsSync(path.join(cwd, 'storage/firebase-dev.json'))).equal(true);
    });

    it('should overwrite a file the checkout already has', async () => {
      fse.outputFileSync(path.join(cwd, 'storage/firebase-dev.json'), 'old');
      const strategy = build({files: ['./templates/firebase-dev.json:storage/firebase-dev.json']});

      await strategy.create('feature/qa', {cwd});

      expect(fse.readFileSync(path.join(cwd, 'storage/firebase-dev.json'), 'utf8')).equal(SECRET);
    });

    it('should set the mode when it is configured', async () => {
      const strategy = build({
        files: ['./templates/firebase-dev.json:storage/firebase-dev.json'],
        mode: '0640'
      });

      await strategy.create('feature/qa', {cwd});

      expect(fse.statSync(path.join(cwd, 'storage/firebase-dev.json')).mode.toString(8).slice(-3)).equal('640');
    });

    it('should log the names of the files, not their content', async () => {
      const strategy = build({files: ['./templates/firebase-dev.json:storage/firebase-dev.json']});

      await strategy.create('feature/qa', {cwd});

      expect(browlUtil.log).calledOnceWithExactly('[browl-plugin-copy] copied ./templates/firebase-dev.json -> storage/firebase-dev.json');
    });

    it('should fail and not create the instance when the source is missing', async () => {
      const strategy = build({files: ['./templates/nope.json:storage/nope.json']});

      const err = await rejected(strategy.create('feature/qa', {cwd}));

      expect(err.message).to.contain('source file not found');
      expect(calls).eql([]);
    });

    it('should refuse a symlinked directory that leads out of the instance directory', async () => {
      const outside = path.join(tmpDir, 'outside');
      fse.ensureDirSync(outside);
      fse.symlinkSync(outside, path.join(cwd, 'storage'));
      const strategy = build({files: ['./templates/firebase-dev.json:storage/firebase-dev.json']});

      const err = await rejected(strategy.create('feature/qa', {cwd}));

      expect(err.message).to.contain('leaves the instance directory');
      expect(fse.readdirSync(outside)).eql([]);
      expect(calls).eql([]);
    });

    it('should refuse to write through a symlinked file', async () => {
      const target = path.join(tmpDir, 'target.txt');
      fse.writeFileSync(target, 'untouched');
      fse.ensureDirSync(path.join(cwd, 'storage'));
      fse.symlinkSync(target, path.join(cwd, 'storage/firebase-dev.json'));
      const strategy = build({files: ['./templates/firebase-dev.json:storage/firebase-dev.json']});

      const err = await rejected(strategy.create('feature/qa', {cwd}));

      expect(err.message).to.contain('symlink');
      expect(fse.readFileSync(target, 'utf8')).equal('untouched');
    });
  });

  describe('update', () => {
    const files = ['./templates/firebase-dev.json:storage/firebase-dev.json'];

    it('should not copy by default', async () => {
      const strategy = build({files});

      await strategy.update('feature/qa', {cwd});

      expect(fse.existsSync(path.join(cwd, 'storage/firebase-dev.json'))).equal(false);
      expect(calls).eql(['update']);
    });

    it('should copy a missing file when update is "missing"', async () => {
      const strategy = build({files, update: 'missing'});

      await strategy.update('feature/qa', {cwd});

      expect(fse.readFileSync(path.join(cwd, 'storage/firebase-dev.json'), 'utf8')).equal(SECRET);
      expect(calls).eql(['update']);
    });

    it('should not overwrite an existing file when update is "missing"', async () => {
      fse.outputFileSync(path.join(cwd, 'storage/firebase-dev.json'), 'changed by hand');
      const strategy = build({files, update: 'missing'});

      await strategy.update('feature/qa', {cwd});

      expect(fse.readFileSync(path.join(cwd, 'storage/firebase-dev.json'), 'utf8')).equal('changed by hand');
      expect(browlUtil.log).not.called;
    });
  });

  describe('configuration', () => {
    it('should do nothing when there are no files', async () => {
      const strategy = build({});

      await strategy.create('feature/qa', {cwd});

      expect(calls).eql(['create']);
      expect(fse.readdirSync(cwd)).eql([]);
    });

    it('should do nothing without a [copy] section', () => {
      const strategy = new NullStrategy('webapp', {conf_dir: confDir}, {});
      const create = strategy.create;

      expect(copyPlugin(strategy).create).equal(create);
    });

    [
      ['no destination', 'templates/a.json', /is not "source:destination"/],
      ['no source', ':storage/a.json', /is not "source:destination"/],
      ['absolute destination', 'templates/a.json:/etc/a.json', /must be relative/],
      ['destination that leaves the directory', 'templates/a.json:../a.json', /must stay in the instance directory/],
      ['sneaky destination', 'templates/a.json:storage/../../a.json', /must stay in the instance directory/]
    ].forEach(([name, entry, message]) => {
      it('should reject ' + name, () => {
        expect(() => build({files: [entry]})).to.throw(message);
      });
    });

    it('should explain when the strategy does not expose its config', () => {
      expect(() => copyPlugin({create: () => Promise.resolve()})).to.throw(/must expose repo, rootConfig and repoConfig/);
    });

    it('should reject an unknown update mode', () => {
      expect(() => build({files: ['a:b'], update: 'always'})).to.throw(/update "always" is not one of: never, missing/);
    });

    it('should reject a mode that is not octal', () => {
      expect(() => build({files: ['a:b'], mode: 'rw-r--r--'})).to.throw(/is not an octal number/);
    });
  });
});
