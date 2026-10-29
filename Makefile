# OmniShell build system.
#
# A plain Makefile is used rather than meson so that building the
# extension needs nothing beyond a POSIX shell, `make`, and the GLib
# tools that are already required to run the extension at all.
#
#   make            build the ZIP (and the compiled resources/schemas)
#   make schemas    compile the GSettings schemas
#   make resources  compile the GResource bundle
#   make catalogues recompile the gettext catalogues from po/*.po
#   make pot        regenerate po/tilingshell.pot and merge it into po/*.po
#   make install    install into ~/.local/share/gnome-shell/extensions
#   make check      run the verification harnesses
#   make clean      remove the build artefacts
#
UUID      := omnishell@spark.dev
SRC       := src
PO        := po
DIST      := build
ZIP       := $(UUID).zip

# The UUID as a directory name inside the archive. The '@' is legal in a
# file name, so the archive keeps the standard extension layout.
STAGE     := $(DIST)/$(UUID)

# Every file that goes into the archive, relative to $(SRC).
SOURCES := $(shell find $(SRC) -type f \
	! -name 'gschemas.compiled' \
	! -name '*.mo.orig' \
	! -name '.gitkeep' \
	| sort)

.PHONY: all build schemas resources catalogues pot install update check clean help

all: build

build: schemas resources catalogues
	@echo "==> Packaging $(ZIP)"
	@rm -rf "$(DIST)" "$(ZIP)"
	@mkdir -p "$(STAGE)"
	@cp -a $(SRC)/. "$(STAGE)/"
	@rm -f "$(STAGE)/gschemas.compiled"
	@# The compiled catalogues and schemas are build products, but they
	@# have to be in the archive, so they are regenerated inside the
	@# staging directory rather than copied.
	@glib-compile-schemas --strict "$(STAGE)/schemas"
	@chmod +x "$(STAGE)/app/ding.js" 2>/dev/null || true
	@cd "$(DIST)" && zip -qr "../$(ZIP)" "$(UUID)"
	@rm -rf "$(DIST)"
	@echo "==> Built $(ZIP)"

schemas:
	@echo "==> Compiling GSettings schemas"
	@glib-compile-schemas --strict "$(SRC)/schemas"

resources:
	@echo "==> Compiling GResource bundle"
	@glib-compile-resources \
		--sourcedir="$(SRC)" \
		--target="$(SRC)/resources.gresource" \
		"$(SRC)/resources.gresource.xml"

catalogues:
	@echo "==> Compiling gettext catalogues"
	@bash $(PO)/compile-catalogues.sh

pot:
	@echo "==> Regenerating the gettext template"
	@bash $(PO)/update-pot.sh

install: build
	@bash install.sh

update:
	@echo "==> Updating OmniShell to latest version"
	@git checkout -- $(ZIP) 2>/dev/null || true
	@git pull --rebase origin main
	@$(MAKE) install

check:
	@echo "==> Syntax check"
	@node check_syntax.mjs
	@echo "==> Fix verification"
	@node verify_fixes.mjs
	@echo "==> SortOrder round-trip verification"
	@node verify_round2.mjs
	@echo "==> Dynamic-layout cache verification"
	@node verify_perf.mjs
	@echo "==> DING refresh verification"
	@node verify_ding_refresh.mjs
	@echo "==> Audit-claim verification"
	@node verify_claims.mjs
	@echo "==> Dynamic-layout math"
	@node test_dyn.mjs
	@echo "==> Pin handling"
	@node verify_pins.mjs
	@echo "==> Gap fill & shrink verification"
	@node verify_gap_fill.mjs
	@echo "==> Schema compilation"
	@glib-compile-schemas --strict "$(SRC)/schemas"
	@echo "All checks passed."

clean:
	@echo "==> Cleaning"
	@rm -rf "$(DIST)" "$(ZIP)"
	@rm -f "$(SRC)/gschemas.compiled" "$(SRC)/schemas/gschemas.compiled"
	@find $(SRC) -name '*.mo' -delete
	@find $(SRC) -name '*.orig' -delete

help:
	@sed -n '2,20p' $(MAKEFILE_LIST) | sed 's/^# \?//'
