#!/usr/bin/env bash
# Mechanical candidate scan for the repo-cleanup skill. Prints CANDIDATES only —
# every hit must be verified by reading the code before it is reported.
# Usage: bash .github/skills/repo-cleanup/scripts/scan.sh [section...]
#   sections: unused clones dupes ghosts planrefs todos big   (default: all)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

SRC=(shared/src server/src client/src scripts)
TESTS=(shared/tests server/tests client/tests e2e/tests)
sections=("$@")
[[ ${#sections[@]} -eq 0 ]] && sections=(unused clones dupes ghosts planrefs todos big)

hdr() { printf '\n━━━ %s ━━━\n' "$1"; }
# Comment lines only (//, /*, or a JSDoc " * " continuation).
comments() { grep -rnIE --include='*.ts' --include='*.css' "(//|/\*|^\s*\*).*($1)" "${@:2}"; }

for s in "${sections[@]}"; do
  case "$s" in
  unused)
    hdr 'Unused files / exports / deps (knip)'
    npx --no-install knip 2>&1 | tail -40
    ;;
  clones)
    # Token-based, so it catches copy-paste with renamed identifiers (fetched via npx on first use).
    hdr 'Copy-pasted blocks (jscpd, ≥50 tokens)'
    npx --yes jscpd@4 --min-tokens 50 --reporters console --format typescript,css \
      --ignore '**/dist/**,**/node_modules/**' "${SRC[@]}" 2>&1 |
      sed 's/\x1b\[[0-9;]*m//g' | grep -A2 'Clone found' | grep -vE '^--$|Clone found' |
      sed -E 's/^\s*-?\s*//; s/ \([0-9]+ lines.*$//' | paste -d'#' - - | sed 's/#/  <->  /'
    ;;
  dupes)
    hdr 'Function names defined in more than one file (private copies are the usual suspects)'
    grep -rnIE --include='*.ts' '^(export )?(async )?function [A-Za-z0-9_]+' "${SRC[@]}" |
      sed -E 's/^([^:]+):[0-9]+:(export )?(async )?function ([A-Za-z0-9_]+).*/\4 \1/' |
      sort -u | awk '{files[$1]=files[$1]" "$2; n[$1]++} END {for (f in n) if (n[f]>1) print n[f]"x "f":"files[f]}' |
      grep -vE '^[0-9]+x apply:' | sort -rn  # `apply` per effect seed is the registry convention
    hdr 'Identical CSS selector names declared twice in one file'
    for f in $(git ls-files '*.css'); do
      grep -nE '^[.#a-z][^{]*\{' "$f" | sed -E 's/^([0-9]+):(.*)\{.*/\2/' | sed 's/ *$//' |
        sort | uniq -d | sed "s|^|$f: |"
    done
    ;;
  ghosts)
    hdr 'Comments that may narrate history / abandoned designs (verify each)'
    comments 'no longer|previously|used to [a-z]+ (it|the|a|with)|the old |originally|formerly|earlier (version|design|draft|approach)|first (version|draft|attempt)|now that|anymore|replaces the|was (removed|dropped|replaced|moved)|moved (from|here)|extracted (verbatim|from)|legacy|the fix\b|the bug\b|a bug where|regression' "${SRC[@]}" |
      grep -vE 'the old (id|key)|no longer (exists|exist|offer|parses|valid)'  # runtime wording, not history
    ;;
  planrefs)
    hdr 'Comments citing plan docs / decision IDs / phases (owner forbids these)'
    comments '\bD[0-9]{1,2}\b|master-plan|[Pp]hase[- ]?[0-9]|docs/plans' "${SRC[@]}" "${TESTS[@]}" |
      grep -vE '\b[23]D\b'
    ;;
  todos)
    hdr 'TODO / FIXME / HACK / XXX / "remove before release"'
    comments 'TODO|FIXME|HACK|XXX|remove before' "${SRC[@]}"
    ;;
  big)
    hdr 'Largest source files (simplification / split candidates)'
    git ls-files "${SRC[@]}" | grep -E '\.(ts|css)$' | xargs wc -l | sort -rn | sed -n '2,13p'
    ;;
  *) echo "unknown section: $s" >&2 ;;
  esac
done
