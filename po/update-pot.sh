#!/usr/bin/env bash
#
# Regenerate po/tilingshell.pot and merge it into every po/*.po file.
#
# The shipped locale/*/LC_MESSAGES/tilingshell.mo catalogues are compiled
# from these .po sources. Without the .po sources a translator cannot
# contribute, and the catalogues can never be updated.
#
# Usage:  ./po/update-pot.sh
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$(cd "$here/.." && pwd)/src"

pot="$here/tilingshell.pot"

echo "Extracting translatable strings from $src ..."
find "$src" -name '*.js' -print0 \
  | xargs -0 xgettext \
      --from-code=UTF-8 \
      --language=JavaScript \
      --keyword=_ \
      --keyword=ngettext:1,2 \
      --keyword=pgettext:1c,2 \
      --keyword=C_:1c,2 \
      --add-comments=Translators \
      --package-name=tilingshell \
      --copyright-holder="OmniShell contributors" \
      --msgid-bugs-address="https://github.com/spark44/omnishell/issues" \
      --output="$pot"

echo "Wrote $pot"

# Merge the fresh template into every existing catalogue.
shopt -s nullglob
for po in "$here"/*.po; do
  echo "Merging $(basename "$po") ..."
  msgmerge --quiet --update --backup=none "$po" "$pot"
done

echo "Done. Now compile with:  ./po/compile-catalogues.sh"
