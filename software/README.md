# Software

## Development Environment

I'm writing JavaScript (ES6), targeting both the [browser](https://www.mozilla.org/firefox/) and [node.js](https://nodejs.org/).

- Package manager: [npm](https://www.npmjs.com/)
- Type checker: [flow](https://flow.org/), [flow-typed](https://github.com/flowtype/flow-typed)
- Transpiler: [babel](https://babeljs.io/) with [babel-preset-env](https://babeljs.io/docs/plugins/preset-env/), [babel-preset-flow](https://babeljs.io/docs/plugins/preset-flow/)
- CSS minifier: [uglifycss](https://github.com/fmarcia/UglifyCSS)
- Bundler: [browserify](http://browserify.org/), [babelify](https://github.com/babel/babelify)
- Testing: [mocha](https://mochajs.org/), [rewire](https://github.com/jhnns/rewire)

To build all modules and bundles run

```
make
```

during development or

```
make release
```

to build minified variants without source maps. To set up the environment run

```bash
make set-up-environment
```

