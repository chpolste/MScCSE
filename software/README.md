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

### On using Flow

Some principles for typed JavaScript that I try to follow:

- Use structural typing instead of nominal typing whenever possible
- Types are documentation and provide a basic level of safety as well as access control (using co- and contravariance)
- Keep it simple, don't overengineer

Particularly, dimensionality of vectors, matrices, geometrical shapes etc. is not handled at the type level (using integer type parameters as is done e.g. in Julia). This way vectors and matrices don't have to be wrapped in custom objects and dimensionality of problems can be chosen more flexibly at runtime.


## Miscellaneous

- Color codes for visualizations: grey (`#CCC`), blue (`#069`), lightblue (`#09C`), green (`#093`), yellow (`#FC0`), orange (`#F60`), red (`#C00`).

