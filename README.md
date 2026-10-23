# browl-plugin-copy

[![test](https://github.com/now-here/browl-plugin-copy/actions/workflows/test.yml/badge.svg)](https://github.com/now-here/browl-plugin-copy/actions/workflows/test.yml) [![npm version](https://img.shields.io/npm/v/browl-plugin-copy.svg)](https://www.npmjs.com/package/browl-plugin-copy) [![license](https://img.shields.io/npm/l/browl-plugin-copy.svg)](LICENSE)

Browl plugin that copies files from the repo config directory (`conf.d/<repo>`) to the work directory of an instance, before the instance is created. Typical use: credentials that must not live in git, like a Firebase service account.

The files are copied right after `git clone` and before the strategy's `create` (`make install`, `make up`), so the app never starts without them.


## Configuration

The `[copy]` section of the repo config:

```ini
plugins[] = browl-plugin-copy

[copy]
files[] = ./templates/firebase-dev.json:storage/firebase-dev.json
```

### files
Type: `string[]`  
Each entry is `source:destination`.

* `source`: absolute, or relative to the repo config directory (`conf.d/<repo>`)
* `destination`: relative to the instance work directory. Absolute paths and `..` are rejected when the plugin is loaded

On create a file that already exists in the checkout is overwritten. A missing source fails the deploy before the instance is created.

### update
Type: `string`  
*Default*: `never`

* `never`: files are copied when an instance is created only
* `missing`: when an instance is updated, a file that is missing in the checkout is copied too (instances created before the plugin was set up get it on their next deploy). An existing file is never overwritten on update

### mode
Type: `string`  
*Default*: the mode of the source file

An octal mode that is set on the copied files, e.g. `0644`. If the app runs in a container as another user (`www-data`), the file must be readable by it, `0640` is not enough.


## Safety

A branch is code written by developers, so the plugin does not trust the checkout: it refuses to write when the destination directory resolves outside of the instance directory (a symlink `storage -> /etc` in the repo), and it refuses to write through a symlink. Contents of the files are never logged, only their names.


## Install

[Browl](https://github.com/killmenot/browl) installs a plugin that is listed in `plugins[]` from npm when it is missing, so adding it to the repo config is enough. To install it up front:

```
$ npm install --global --prefix ~/.browl/plugins browl-plugin-copy
```


## Example

```ini
; conf.d/core/config.ini
deploy = make

plugins[] = browl-plugin-dotenv
plugins[] = browl-plugin-copy

[copy]
files[] = ./templates/firebase-dev.json:storage/firebase-dev.json
update = missing
mode = 0644
```

Add the destination to `.gitignore` of the repo, otherwise the credential shows up as an untracked file in every checkout.


## Contributing

Issues and pull requests are welcome. Please add a test for a change and run `npm run lint` and `npm test` before you open a pull request.

## Development

```
$ npm install
$ npm run lint
$ npm test
```


## License

[MIT](LICENSE)
