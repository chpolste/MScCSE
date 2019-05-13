# Thesis Document Makefile

CHAPTERS = $(wildcard chapters/*.tex)
FIGURES = $(wildcard figures/*.svg) figures/TUM-logo.pdf
INPUTS = $(wildcard inputs/*)


.PHONY: all clean

all: thesis.pdf

clean:
	rm -f *.aux
	rm -f *.bbl
	rm -f *.blg
	rm -f *.log
	rm -f *.tuc
	rm -f *.pdf
	rm -f figures/*.svg.pdf

thesis.pdf: thesis.tex $(CHAPTERS) $(FIGURES) $(INPUTS)
	contextjit thesis.tex

