# CLI tools and their flags

BABEL_FLAGS = --source-maps inline
BABEL = npx babel $(BABEL_FLAGS)

BABELIFY_FLAGS = 
BROWSERIFY_FLAGS = --debug
BROWSERIFY = npx browserify $(BROWSERIFY_FLAGS) -t [ babelify $(BABELIFY_FLAGS) ]

MOCHA_FLAGS = --require @babel/register --timeout 5000
MOCHA = npx mocha $(MOCHA_FLAGS)

UGLIFYCSS_FLAGS = 
UGLIFYCSS = npx uglifycss $(UGLIFYCSS_FLAGS)

FLOW = npx flow 
FLOW_TYPED = npx flow-typed

HTML_INJECT_FLAGS = 
HTML_INJECT = ./scripts/html-inject $(HTML_INJECT_FLAGS)


# Directories and files

# Source code
SRC = ./src
SRC_JS = $(SRC)/js
SRC_CSS = $(SRC)/css
SRC_HTML = $(SRC)/html
SRC_SVG = $(SRC)/svg

TARGETS = $(wildcard $(SRC)/*/targets.d)

# Test code
TEST = ./test
TEST_JS = $(TEST)/js

# Browser apps
DIST = ./dist
DIST_JS = $(DIST)/js
DIST_CSS = $(DIST)/css
DIST_HTML = $(DIST)
DIST_SVG = $(DIST)/svg

# Compiled JS modules for use with node
JS_MODULES = ./modules
JS_MODULES_FILES = $(JS_MODULES)/geometry.js $(JS_MODULES)/linalg.js $(JS_MODULES)/tools.js \
                   $(JS_MODULES)/parser.js $(JS_MODULES)/presets.js $(JS_MODULES)/logic.js \
                   $(JS_MODULES)/game.js $(JS_MODULES)/refinement.js $(JS_MODULES)/controller.js \
				   $(JS_MODULES)/snapshot.js $(JS_MODULES)/system.js \
				   $(JS_MODULES)/benchmark-integrator.js $(JS_MODULES)/benchmark-corridor.js


# General rules

.PHONY: all release dist-setup node-setup clean test check inspector modules targets

all: modules inspector polytopic-plotter polytopic-calculator

release:
	@make clean
	@make targets
	@make --always-make --no-print-directory \
			BABEL_FLAGS="--minified --no-comments" \
			BABELIFY_FLAGS="--minified --no-comments" \
			BROWSERIFY_FLAGS=""

targets:
	scripts/generate-targets $(SRC_JS)/*.js > $(SRC_JS)/targets.d

dist-setup:
	mkdir -p $(DIST_JS)
	mkdir -p $(DIST_CSS)
	mkdir -p $(DIST_HTML)
	mkdir -p $(DIST_SVG)
	mkdir -p $(JS_MODULES)

node-setup:
	npm install
	$(FLOW_TYPED) install --skip

clean:
	rm -f  $(TARGETS)
	rm -f  $(DIST_JS)/*.js
	rm -f  $(DIST_CSS)/*.css
	rm -rf $(DIST_CSS)/fonts
	rm -f  $(DIST_HTML)/*.html
	rm -f  $(DIST_SVG)/*.svg
	rm -f  $(JS_MODULES)/*.js

test:
	$(MOCHA) $(TEST_JS)

check:
	$(FLOW) check


# Modules

modules: $(JS_MODULES_FILES)


# Apps

inspector: $(DIST_HTML)/inspector.html $(DIST_CSS)/inspector.css $(DIST_JS)/inspector.js \
		$(DIST_JS)/inspector-worker-system.js $(DIST_SVG)/loading16.svg

polytopic-plotter: $(DIST_HTML)/polytopic-plotter.html $(DIST_JS)/polytopic-plotter.js $(DIST_CSS)/polytopic-plotter.css

polytopic-calculator: $(DIST_HTML)/polytopic-calculator.html \
		$(DIST_CSS)/polytopic-calculator.css $(DIST_JS)/polytopic-calculator.js


# File rules

$(DIST_HTML)/%.html: $(SRC_HTML)/%.html
	$(HTML_INJECT) $< $@

$(DIST_CSS)/%.css: $(SRC_CSS)/%.css
	$(UGLIFYCSS) --output $@ $<

$(JS_MODULES)/%.js: $(SRC_JS)/%.js
	$(BABEL) --out-file $@ $<

$(DIST_JS)/%.js: $(SRC_JS)/%.js
	$(BROWSERIFY) $< > $@

$(DIST_SVG)/%.svg: $(SRC_SVG)/%.svg
	cp $< $@

# There are no intermediate files that communicate changes of non-direct
# dependencies to the apps built by browserify, so either all dependencies have
# to be listed explicitly for each app (error-prone) or the dependency graph
# can be represented by empty targets that propagate changes by touching each
# dependency in a chain. This causes unnecessary rebuilds of the module files
# and sometimes vim will complain about outdated files but it creates a proper
# dependency chain for the browserify builds. 

# See: https://www.gnu.org/software/make/manual/make.html#Empty-Targets

-include $(TARGETS)

