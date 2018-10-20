# Software

## Applications

- [__Inspector__](https://chpolste.github.io/MScCSE/software/dist/inspector.html): visualization of the LSS abstraction-refinement and analysis.
- [__Plotter 2D__](https://chpolste.github.io/MScCSE/software/dist/plotter-2d.html): vertex-based preview of polytopes. Useful for debugging and custom figure creation.
- [__Polytopic Calculator__](https://chpolste.github.io/MScCSE/software/dist/polytopic-calculator.html): polytopic computations with visualizations.

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

