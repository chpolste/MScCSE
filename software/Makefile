# Directories
SRC = src
TEST = test
BUILD = build
NODE_BIN = node_modules/.bin

.PHONY: all build setup-environment clean test check


all:

build:

setup-environment:
	mkdir -p build
	npm install flow-bin flow-remove-types
	npm install browserify unflowify
	npm install mocha rewire

clean:
	rm -f $(BUILD)/*.js

test:
	$(NODE_BIN)/mocha --require flow-remove-types/register

check:
	$(NODE_BIN)/flow check
