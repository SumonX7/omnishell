#!/usr/bin/env bash
#
# Compile every po/*.po into src/locale/<lang>/LC_MESSAGES/tilingshell.mo
#
# Usage:  ./po/compile-catalogues.sh
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$(cd "$here/.." && pwd)/src"

shopt -s nullglob
for po in "$here"/*.po; do
  lang="$(basename "$po" .po)"
  outdir="$src/locale/$lang/LC_MESSAGES"
  mkdir -p "$outdir"
  msgfmt --check --output-file="$outdir/tilingshell.mo" "$po"
  echo "compiled $lang -> $outdir/tilingshell.mo"
done

echo "Done."
