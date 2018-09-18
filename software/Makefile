# CLI tools and their flags

NODE_BIN = ./node_modules/.bin

BABEL_FLAGS = --source-maps inline
BABEL = $(NODE_BIN)/babel $(BABEL_FLAGS)

BABELIFY_FLAGS = 
BROWSERIFY_FLAGS = --debug
BROWSERIFY = $(NODE_BIN)/browserify $(BROWSERIFY_FLAGS) -t [ babelify $(BABELIFY_FLAGS) ]

MOCHA_FLAGS = --require babel-core/register --timeout 5000
MOCHA = $(NODE_BIN)/mocha $(MOCHA_FLAGS)

UGLIFYCSS_FLAGS = 
UGLIFYCSS = $(NODE_BIN)/uglifycss $(UGLIFYCSS_FLAGS)

FLOW = $(NODE_BIN)/flow 
FLOW_TYPED = $(NODE_BIN)/flow-typed

HTML_INJECT_FLAGS = 
HTML_INJECT = ./scripts/html-inject


# Directories and files

# Source code
SRC = ./src
SRC_JS = $(SRC)/js
SRC_CSS = $(SRC)/css
SRC_HTML = $(SRC)/html

# Test code
TEST = ./test
TEST_JS = $(TEST)/js

# Browser apps
DIST = ./dist
DIST_JS = $(DIST)/js
DIST_CSS = $(DIST)/css
DIST_FONTS = $(DIST_CSS)/fonts
DIST_HTML = $(DIST)

# Compiled JS modules for use with node
JS_MODULES = ./modules
JS_MODULES_FILES = $(JS_MODULES)/geometry.js $(JS_MODULES)/linalg.js $(JS_MODULES)/tools.js \
                   $(JS_MODULES)/parser.js $(JS_MODULES)/presets.js $(JS_MODULES)/logic.js \
                   $(JS_MODULES)/game.js


# General rules

.PHONY: all release set-up-environment clean test check inspector

all: $(JS_MODULES_FILES) inspector

release:
	@make clean
	@make --always-make --no-print-directory \
			BABEL_FLAGS="--minified --no-comments" \
			BABELIFY_FLAGS="--minified --no-comments" \
			BROWSERIFY_FLAGS=""

set-up-environment:
	mkdir -p $(DIST_JS)
	mkdir -p $(DIST_CSS)
	mkdir -p $(DIST_HTML)
	mkdir -p $(JS_MODULES)
	npm install
	$(FLOW_TYPED) install --skip

clean:
	rm -f $(DIST_JS)/*.js
	rm -f $(DIST_CSS)/*.css
	rm -rf $(DIST_FONTS)
	rm -f $(DIST_HTML)/*.html
	rm -f $(JS_MODULES)/*.js

test:
	$(MOCHA) $(TEST_JS)

check:
	$(FLOW) check


# Apps

inspector: $(DIST_HTML)/inspector.html $(DIST_CSS)/inspector.css $(DIST_JS)/inspector.js \
		$(DIST_JS)/inspector-worker-analysis.js


# File rules

$(DIST_HTML)/%.html: $(SRC_HTML)/%.html
	$(HTML_INJECT) $(HTML_INJECT_FLAGS) $< $@

$(DIST_CSS)/%.css: $(SRC_CSS)/%.css
	$(UGLIFYCSS) --output $@ $<

$(JS_MODULES)/%.js: $(SRC_JS)/%.js
	$(BABEL) --out-file $@ $<

$(DIST_JS)/%.js: $(SRC_JS)/%.js
	$(BROWSERIFY) $< > $@


# There are no intermediate files that communicate changes of non-direct
# dependencies to the apps built by browserify, so either all dependencies have
# to be listed explicitly for each app (error-prone) or the dependency graph
# can be represented by empty targets that propagate changes by touching each
# dependency in a chain. This causes unnecessary rebuilds of the module files
# and sometimes vim will complain about outdated files but it creates a proper
# dependency chain for the browserify builds. 

# See: https://www.gnu.org/software/make/manual/make.html#Empty-Targets
# Bonus TODO: generate these automatically from imports in the files (like gcc -M)

$(SRC_JS)/figure.js: $(SRC_JS)/linalg.js $(SRC_JS)/tools.js
	@touch $(SRC_JS)/figure.js

$(SRC_JS)/game.js: $(SRC_JS)/tools.js $(SRC_JS)/logic.js
	@touch $(SRC_JS)/game.js

$(SRC_JS)/geometry.js: $(SRC_JS)/linalg.js $(SRC_JS)/tools.js $(SRC_JS)/parser.js
	@touch $(SRC_JS)/geometry.js

$(SRC_JS)/inspector.js: $(SRC_JS)/presets.js $(SRC_JS)/system.js $(SRC_JS)/dom.js \
		$(SRC_JS)/inspector-widgets-setup.js $(SRC_JS)/inspector-widgets-inspector.js
	@touch $(SRC_JS)/inspector.js

$(SRC_JS)/inspector-widgets-setup.js: $(SRC_JS)/presets.js $(SRC_JS)/dom.js \
		$(SRC_JS)/tools.js $(SRC_JS)/geometry.js $(SRC_JS)/logic.js $(SRC_JS)/figure.js \
		$(SRC_JS)/widgets-plot.js $(SRC_JS)/widgets-input.js $(SRC_JS)/system.js \
		$(SRC_JS)/inspector-widgets-inspector.js
	@touch $(SRC_JS)/inspector-widgets-setup.js

$(SRC_JS)/inspector-widgets-inspector.js: $(SRC_JS)/linalg.js $(SRC_JS)/dom.js \
		$(SRC_JS)/tools.js $(SRC_JS)/geometry.js $(SRC_JS)/logic.js $(SRC_JS)/figure.js \
		$(SRC_JS)/widgets-plot.js $(SRC_JS)/widgets-input.js $(SRC_JS)/game.js \
		$(SRC_JS)/system.js $(SRC_JS)/worker.js
	@touch $(SRC_JS)/inspector-widgets-inspector.js

$(SRC_JS)/inspector-worker-analysis.js: $(SRC_JS)/tools.js $(SRC_JS)/logic.js $(SRC_JS)/game.js \
		$(SRC_JS)/worker.js
	@touch $(SRC_JS)/inspector-worker-analysis.js

$(SRC_JS)/linalg.js: $(SRC_JS)/tools.js
	@touch $(SRC_JS)/linalg.js

$(SRC_JS)/logic.js: $(SRC_JS)/parser.js $(SRC_JS)/tools.js
	@touch $(SRC_JS)/logic.js

$(SRC_JS)/system.js: $(SRC_JS)/tools.js $(SRC_JS)/linalg.js $(SRC_JS)/geometry.js
	@touch $(SRC_JS)/system.js

$(SRC_JS)/widgets-input.js: $(SRC_JS)/dom.js $(SRC_JS)/tools.js
	@touch $(SRC_JS)/widgets-input.js

$(SRC_JS)/widgets-plot.js: $(SRC_JS)/linalg.js $(SRC_JS)/dom.js $(SRC_JS)/tools.js
	@touch $(SRC_JS)/widgets-plot.js

