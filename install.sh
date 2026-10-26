#!/bin/bash
#
# OmniShell installer.
#
# Installs the extension into the user extension directory, compiles the
# GSettings schemas, and (on X11) offers to reload the running shell so the
# new code is picked up without a logout.
#
set -euo pipefail

EXTENSION_UUID="omnishell@spark.dev"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
ZIP_FILE="${ZIP_FILE:-$SCRIPT_DIR/$EXTENSION_UUID.zip}"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m  !!\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

TEMP_ZIP=""
cleanup() {
  [ -n "$TEMP_ZIP" ] && rm -f "$TEMP_ZIP" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- checks ---
info "Checking the environment..."

command -v unzip >/dev/null 2>&1 || fail "'unzip' is required but was not found."
command -v glib-compile-schemas >/dev/null 2>&1 \
  || fail "'glib-compile-schemas' is required but was not found (install glib2-devel / libglib2.0-dev)."

# The extension is a GJS/ESM application, so a GJS interpreter and the
# GTK 4 / libadwaita typelibs must be present for the desktop-icons part
# to run at all.
if ! command -v gjs >/dev/null 2>&1; then
  warn "'gjs' was not found in PATH. The desktop-icons feature will not work."
else
  ok "gjs: $(command -v gjs)"
fi

for typlib in Gtk-4.0 Adw-1 GnomeDesktop-4.0; do
  if ! ls /usr/lib*/girepository-1.0/"$typlib".typelib >/dev/null 2>&1 \
     && ! ls /usr/lib/*/girepository-1.0/"$typlib".typelib >/dev/null 2>&1 \
     && ! ls /usr/share/gir-1.0/"$typlib".typelib >/dev/null 2>&1; then
    warn "The '$typlib' typelib was not found. Some features may be unavailable."
  else
    ok "typelib: $typlib"
  fi
done

if [ ! -f "$ZIP_FILE" ]; then
  info "Local archive not found. Fetching latest release archive from GitHub..."
  TEMP_ZIP="$(mktemp -t "${EXTENSION_UUID}-XXXXXX.zip" 2>/dev/null || mktemp "${TMPDIR:-/tmp}/${EXTENSION_UUID}-XXXXXX.zip")"
  DOWNLOAD_URL="https://github.com/SumonX7/OmniShell/releases/latest/download/${EXTENSION_UUID}.zip"
  FALLBACK_URL="https://raw.githubusercontent.com/SumonX7/OmniShell/main/${EXTENSION_UUID}.zip"

  if command -v curl >/dev/null 2>&1; then
    if ! curl -sSL --fail -o "$TEMP_ZIP" "$DOWNLOAD_URL"; then
      curl -sSL --fail -o "$TEMP_ZIP" "$FALLBACK_URL" || fail "Failed to download extension archive from GitHub."
    fi
  elif command -v wget >/dev/null 2>&1; then
    if ! wget -qO "$TEMP_ZIP" "$DOWNLOAD_URL"; then
      wget -qO "$TEMP_ZIP" "$FALLBACK_URL" || fail "Failed to download extension archive from GitHub."
    fi
  else
    fail "Neither 'curl' nor 'wget' was found to download the extension."
  fi
  ZIP_FILE="$TEMP_ZIP"
  ok "downloaded latest release archive"
fi

# ------------------------------------------------------- validate the zip ---
info "Validating $ZIP_FILE..."

# The archive must contain exactly one top-level directory named after the
# extension UUID. Anything else would install to the wrong path.
ZIP_TOP="$(unzip -Z1 "$ZIP_FILE" | awk -F/ 'NF{print $1}' | sort -u)"
if [ "$ZIP_TOP" != "$EXTENSION_UUID" ]; then
  fail "The archive must contain a single top-level directory named '$EXTENSION_UUID', but found: $ZIP_TOP"
fi
if ! unzip -Z1 "$ZIP_FILE" | grep -qx "$EXTENSION_UUID/metadata.json"; then
  fail "The archive does not contain '$EXTENSION_UUID/metadata.json'."
fi
if ! unzip -tq "$ZIP_FILE" >/dev/null 2>&1; then
  fail "The archive is corrupt (unzip -t failed)."
fi
ok "archive layout and integrity"

# ------------------------------------------------------------- install ---
info "Disabling conflicting extensions..."
# The upstream Tiling Shell and DING extensions implement the same
# features and fight with OmniShell for the same windows.
gnome-extensions disable tilingshell@ferrarodomenico.com 2>/dev/null || true
gnome-extensions disable ding@rastersoft.com 2>/dev/null || true

# The extension overwrites itself, so it has to be disabled first: with the
# extension still enabled, GNOME Shell keeps running the old code from the
# deleted directory and the new files are never picked up.
info "Disabling OmniShell before replacing it..."
gnome-extensions disable "$EXTENSION_UUID" 2>/dev/null || true

info "Extracting the extension..."
# Keep a backup of the previous installation so that a failed extraction can
# be rolled back instead of leaving the user with a half-installed extension.
BACKUP_DIR="$EXTENSION_DIR.bak"
rm -rf "$BACKUP_DIR"
if [ -d "$EXTENSION_DIR" ]; then
  cp -a "$EXTENSION_DIR" "$BACKUP_DIR"
  ok "previous installation backed up to $BACKUP_DIR"
fi
rm -rf "$EXTENSION_DIR"
mkdir -p "$(dirname "$EXTENSION_DIR")"
# The archive already contains the "$EXTENSION_UUID" directory, so it is
# extracted into its *parent*. Extracting into "$EXTENSION_DIR" itself
# would nest the files one level too deep.
if ! unzip -q "$ZIP_FILE" -d "$(dirname "$EXTENSION_DIR")"; then
  fail "Extraction failed - restoring the previous installation."
  rm -rf "$EXTENSION_DIR"
  [ -d "$BACKUP_DIR" ] && mv "$BACKUP_DIR" "$EXTENSION_DIR"
  exit 1
fi
rm -rf "$BACKUP_DIR"

if [ ! -d "$EXTENSION_DIR" ]; then
  fail "The archive did not produce the expected directory '$EXTENSION_DIR'."
fi
ok "extracted to $EXTENSION_DIR"

info "Compiling the GSettings schemas..."
glib-compile-schemas --strict "$EXTENSION_DIR/schemas" \
  || fail "The GSettings schemas are invalid."
ok "schemas compiled"

# ------------------------------------------------------- shadowed schemas ---
# A copy of the tiling schema in the *user* schema directory
# (~/.local/share/glib-2.0/schemas) takes precedence over the one that
# ships with the extension, because the user directory is searched first.
# When such a stale copy is present, the shell reads the *old* key set and
# every setting the extension has added is missing -- which shows up as
# errors like
#
#   Settings schema 'org.gnome.shell.extensions.tilingshell' does not
#   contain a key named 'enable-dynamic-tiling'
#
# and, more importantly, as auto-tiling silently not working.
#
# The user-level copy is therefore replaced with the extension's own and
# recompiled. The system directory (/usr/share/glib-2.0/schemas) is *not*
# touched: it needs root, and it is only consulted when the user directory
# does not provide the schema.
USER_SCHEMA_DIR="$HOME/.local/share/glib-2.0/schemas"
SHADOWED=0
for schema in "$EXTENSION_DIR"/schemas/*.gschema.xml; do
  [ -e "$schema" ] || continue
  name="$(basename "$schema")"
  target="$USER_SCHEMA_DIR/$name"
  if [ -f "$target" ] && ! cmp -s "$schema" "$target"; then
    SHADOWED=1
  fi
done

if [ "$SHADOWED" -eq 1 ]; then
  info "Updating the user-level schema copies..."
  mkdir -p "$USER_SCHEMA_DIR"
  for schema in "$EXTENSION_DIR"/schemas/*.gschema.xml; do
    [ -e "$schema" ] || continue
    cp -f "$schema" "$USER_SCHEMA_DIR/$(basename "$schema")"
  done
  # The upstream DING schema used the same path as OmniShell's own. It is
  # kept as a ".disabled" file so that it cannot shadow the current one.
  if [ -f "$USER_SCHEMA_DIR/org.gnome.shell.extensions.ding.gschema.xml" ]; then
    mv -f "$USER_SCHEMA_DIR/org.gnome.shell.extensions.ding.gschema.xml" \
          "$USER_SCHEMA_DIR/org.gnome.shell.extensions.ding.gschema.xml.disabled"
  fi
  glib-compile-schemas "$USER_SCHEMA_DIR" \
    || fail "The user-level GSettings schemas could not be compiled."
  ok "stale user-level schemas replaced and recompiled"
else
  ok "no shadowed user-level schemas"
fi

info "Setting permissions..."
chmod +x "$EXTENSION_DIR/app/ding.js" 2>/dev/null || true

# -------------------------------------------------------------- finish ---
info "Enabling the extension..."
# Ensure desktop icons fusion is enabled in GSettings
gsettings set org.gnome.shell.extensions.tilingshell enable-desktop-icons true 2>/dev/null || true
gnome-extensions install --force "$ZIP_FILE" 2>/dev/null || true
gnome-extensions enable "$EXTENSION_UUID" 2>/dev/null || true

printf '\n\033[1;32m==========================================================\033[0m\n'
printf '\033[1;32m OmniShell installed successfully!\033[0m\n'
printf '\033[1;32m Location: %s\033[0m\n' "$EXTENSION_DIR"
printf '\033[1;32m==========================================================\033[0m\n\n'

# ----------------------------------------------------------- live reload ---
# On Wayland the shell cannot be restarted in place, so the user has to log
# out and back in. On X11 `Alt+F2` + `r` reloads the shell immediately.
SESSION_TYPE="${XDG_SESSION_TYPE:-}"
if [ "$SESSION_TYPE" = "x11" ]; then
  cat <<'EOF'
Reload the running shell to pick up the new code:

    Alt+F2  ->  r  ->  Enter

(Or log out and back in if you prefer.)

EOF
else
  cat <<'EOF'
This is a Wayland session, so the shell cannot be reloaded in place.
Log out and log back in to load the new code:

    Log out  ->  Log in

EOF
fi

cat <<'EOF'
Then confirm the extension is active:

    gnome-extensions info omnishell@spark.dev

EOF
