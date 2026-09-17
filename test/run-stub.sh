#!/bin/sh
# Stands in for the harness `card run` launches, so the tests exercise the loop
# without a model. The launch command in the test's config is
# `<this script> <control directory> <card entry point>`, and everything after
# that is what the verb itself passes.
#
# Each line of `<control directory>/<id>` is one thing to do for that card:
#
#   done          close the card --done, the way a finished session would
#   dirty <path>  write to that path, the way a session leaves work behind
#
# A card with no control file is left open, which is a session handing back.
set -eu
control="$1"
cli="$2"
shift 2

model=""
session=""
prompt=""
while [ $# -gt 0 ]; do
  case "$1" in
    --model) model="$2" ;;
    --session-id) session="$2" ;;
  esac
  prompt="$1"
  shift
done
id="${prompt##* }"

echo "stub ran for $id"
echo "session $session"
echo "model ${model:-none}"

[ -f "$control/$id" ] || exit 0
while read -r verb rest; do
  case "$verb" in
    done) echo "stub close note" | "$cli" close "$id" --done ;;
    dirty) echo "stub dirt for $id" > "$rest" ;;
  esac
done < "$control/$id"
