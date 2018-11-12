# Organization

## Libraries

- `js/dom.js`: general support for DOM operations (node creation and manipulation), keybindings
- `js/figure.js`: layered model of plots, projections, shape and primitive definitions
- `js/game.js`: 2-player probabilistic game representation with solver for parity-3 objective
- `js/geometry.js`: convex geometry (halfspaces, polytopes) in 1D and 2D
- `js/linalg.js`: some matrix and vector operations
- `js/logic.js`: representation, parsing, printing and evaluation of propositional logic formulas, one-pair Strertt automaton representation of LTL objectives
- `js/parser.js`: precedence climbing parser for mathematical expressions
- `js/presets.js`: predefined objectives and hybrid system setups for applications and tests
- `js/system.js`: LSS and its abstraction (states, actions, action supports), polytopic operators, refinement
- `js/tools.js`: helper functions for arrays, iterators, sets, objects and strings, observer pattern mixin, custom collections
- `js/widgets-input.js`: input fields with automatic validation and value conversion
- `js/widgets-plot.js`: SVG plots in the browser
- `js/worker.js`: web worker communication


## Applications

### Inspector

- `js/inspector.js`
- `css/inspector.css`
- `html/inspector.html`
- `js/inspector-widgets-inspector.js`: widget collection for problem exploration
- `js/inspector-widgets-setup.js`: widget collection for problem input
- `js/inspector-worker-analysis.js`: web worker for game construction and analysis
- `js/inspector-worker-system.js`: web worker for system abstraction management and operations

### Plotter 2D

- `js/plotter-2d.js`
- `css/plotter-2d.css`
- `html/plotter-2d.html`

### Polytopic Calculator

- `js/polytopic-calculator.js`
- `css/polytopic-calculator.css`
- `html/polytopic-calculator.html`

