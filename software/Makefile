# CLI tools and their flags

NODE_BIN = ./node_modules/.bin

BABEL_FLAGS = --source-maps inline
BABEL = $(NODE_BIN)/babel $(BABEL_FLAGS)

BABELIFY_FLAGS = 
BROWSERIFY_FLAGS = --debug
BROWSERIFY = $(NODE_BIN)/browserify $(BROWSERIFY_FLAGS) -t [ babelify $(BABELIFY_FLAGS) ]

MOCHA_FLAGS = --require babel-core/register
MOCHA = $(NODE_BIN)/mocha $(MOCHA_FLAGS)

UGLIFYCSS_FLAGS = 
UGLIFYCSS = $(NODE_BIN)/uglifycss $(UGLIFYCSS_FLAGS)

FLOW = $(NODE_BIN)/flow 
FLOW_TYPED = $(NODE_BIN)/flow-typed


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
DIST_HTML = $(DIST)

# Compiled JS modules for use with node
JS_MODULES = ./modules
JS_MODULES_FILES = $(JS_MODULES)/geo.js


# General rules

.PHONY: all release set-up-environment clean test check

all: $(JS_MODULES_FILES) reach

release:
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
	rm -f $(DIST_HTML)/*.html
	rm -f $(JS_MODULES)/*.js

test:
	$(MOCHA) $(TEST_JS)

check:
	$(FLOW) check


# Apps

reach: $(DIST_HTML)/reach.html $(DIST_JS)/reach.js $(DIST_CSS)/reach.css $(DIST_CSS)/widget.css


# File rules

$(DIST_HTML)/%.html: $(SRC_HTML)/%.html
	cp $< $@

$(DIST_CSS)/%.css: $(SRC_CSS)/%.css
	$(UGLIFYCSS) --output $@ $<

$(DIST_JS)/%.js: $(SRC_JS)/%.js
	$(BROWSERIFY) $< > $@

$(JS_MODULES)/%.js: $(SRC_JS)/%.js
	$(BABEL) --out-file $@ $<

