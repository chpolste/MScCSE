# Software

## Applications

- Inspector: visualization of the LSS abstraction-refinement and analysis. Access a current build from the dist branch [here](https://htmlpreview.github.io/?https://github.com/chpolste/MScCSE/blob/dist/software/dist/inspector.html).


## Development Environment

I'm writing JavaScript (ES6), targeting both the [browser](https://www.mozilla.org/firefox/) and [node.js](https://nodejs.org/).

- Package manager: [npm](https://www.npmjs.com/)
- Type checker: [flow](https://flow.org/), [flow-typed](https://github.com/flowtype/flow-typed)
- Transpiler: [babel](https://babeljs.io/) with [babel-preset-env](https://babeljs.io/docs/plugins/preset-env/), [babel-preset-flow](https://babeljs.io/docs/plugins/preset-flow/)
- CSS minifier: [uglifycss](https://github.com/fmarcia/UglifyCSS)
- Bundler: [browserify](http://browserify.org/), [babelify](https://github.com/babel/babelify)
- Testing: [mocha](https://mochajs.org/), [rewire](https://github.com/jhnns/rewire)
- Maths renderer: [KaTeX](https://github.com/Khan/KaTeX)

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

### KaTeX injection

By default KaTeX is included into the builds locally, i.e. all necessary files (JavaScript, CSS, fonts) are copied into the `dist` directory from the KaTeX node module. To switch to a CDN-based inclusion of KaTeX the `-CDN` flag has to be set for the `html-inject` script. This can be done by specifying `HTML_INJECT_FLAGS="-CDN"` when calling `make`.


### On using Flow

Some principles for typed JavaScript that I try to follow:

- Use structural typing instead of nominal typing whenever possible
- Types are documentation and provide a basic level of safety as well as access control (using co- and contravariance)
- Keep it simple, don't overengineer

In particular, dimensionality of vectors, matrices, geometrical shapes etc. is not handled at the type level (using integer type parameters as is done e.g. in Julia). This way vectors and matrices don't have to be wrapped in custom objects and dimensionality of problems can be chosen more flexibly at runtime.


## Miscellaneous

- Color codes for visualizations: grey (`#CCC`), blue (`#069`), lightblue (`#09C`), green (`#093`), yellow (`#FC0`), orange (`#F60`), red (`#C00`), purple (`#606`).

