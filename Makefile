SHELL := /bin/bash
CPUS := $(shell (nproc --all || sysctl -n hw.ncpu) 2>/dev/null || echo 1)
#$(info $$MAKEFLAGS is          [$(MAKEFLAGS)])
$(info $$CPUS is            $(CPUS))

NODES := nigfete pigfete

TEX_NODE_FILES := $(foreach node,$(NODES),build/${node}_node.tex)
PDF_NODE_FILES := $(foreach node,$(NODES),build/${node}_node.pdf)
SVG_NODE_FILES := $(foreach node,$(NODES),build/${node}_node.svg)

$(info $$NODES is          [${NODES}])
$(info $$TEX_NODE_FILES is [${TEX_NODE_FILES}])
$(info $$PDF_NODE_FILES is [${PDF_NODE_FILES}])
$(info $$SVG_NODE_FILES is [${SVG_NODE_FILES}])

# Targets without real file names:
.PHONY: useAllCores all all-tex all-pdf all-svg clean clean-all
# Log files --> can safely be deleted:
.INTERMEDIATE: build/%.log build/%.aux
# Also "wanted" files:
.SECONDARY: build/%.pdf build/%.tex
# Delete the default suffixes:
.SUFFIXES:
# Use all target if no target has been specified
.DEFAULT_GOAL := all

useAllCores:
	@[[ "$(MAKEFLAGS)" == *"-j"* ]] && echo "Jobcount already set" || echo "Jobcount not set, Forcing $(CPUS)"
	$(eval MAKEFLAGS += $(shell [[ "$(MAKEFLAGS)" == *"-j"* ]] || echo "-j$(CPUS)"))
#	$(info $$MAKEFLAGS is          [$(MAKEFLAGS)])

all: all-tex all-pdf all-svg

all-tex: useAllCores ${TEX_NODE_FILES}

all-pdf: useAllCores ${PDF_NODE_FILES}

all-svg: useAllCores ${SVG_NODE_FILES}

build/%_node.tex:
	@echo "Creating file \"$@\" using stencil \"stencil_pgf.tex\""
	@mkdir -p build
	@cat "stencil_pgf_pre.tex" > "$@"
	@echo -n $* >> "$@"
	@cat "stencil_pgf_post.tex" >> "$@"

#build/%.pdf: build/%.tex
#	@echo "Running pdflatex on \"$<\""
#	@pdflatex -halt-on-error -interaction=nonstopmode -jobname="$*" --output-directory "build" "$<" > /dev/null

#build/%.svg: build/%.pdf
#	@echo "Convert PDF to SVG (inkscape) and optimize (svgo): \"$<\" --> \"$@\""
#	@inkscape --export-type=svg --vacuum-defs --export-area-drawing --export-plain-svg -o - "$<" | svgo -i - -o "$@" --pretty --eol lf --final-newline
#@inkscape --export-type=svg --vacuum-defs --export-area-drawing --export-plain-svg  -o "$@" "$<"

#@inkscape --pdf-poppler --export-type=svg -o "$@" "$<"

build/%.dvi: build/%.tex
	@echo "Running lualatex on \"$<\""
	@lualatex -halt-on-error -interaction=nonstopmode -jobname="$*" --output-format=dvi --output-directory "build" "$<" > /dev/null

build/%.svg: build/%.dvi
	dvisvgm --bbox=min -j --optimize=none --translate=72.000004,72.000006 --scale=1.3333333333333333333333333333333333 "$<"

clean:
	@rm -f build/*.log build/*.aux

clean-all:
	@rm -f build/*
