#!/bin/sh
# Stands in for the harnesses `card run` launches, and for `sbox`, so the tests
# exercise the loop without a model. The tests link it onto PATH as `claude`,
# `pi` and `sbox`, and it tells which it is from the name it ran as: as `sbox`
# it says so and runs its arguments, the way the wrapper does, and as a harness
# it echoes its own argv, everything of which is what the verb passes.
#
# A harness reads its control directory from RUN_STUB_CONTROL and the card
# entry point from RUN_STUB_CLI. Each line of `<control directory>/<id>` is one
# thing to do for that card:
#
#   done          close the card --done, the way a finished session would
#   dirty <path>  write to that path, the way a session leaves work behind
#
# A card with no control file is left open, which is a session handing back.
set -eu
name="${0##*/}"
if [ "$name" = sbox ]; then
  echo "sbox wrapped"
  exec "$@"
fi
control="$RUN_STUB_CONTROL"
cli="$RUN_STUB_CLI"

argv="$*"
session=""
prompt=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-id) session="$2" ;;
  esac
  prompt="$1"
  shift
done
id="${prompt##* }"

echo "stub ran for $id"
echo "harness $name"
echo "argv $argv"
echo "session $session"

[ -f "$control/$id" ] || exit 0
while read -r verb rest; do
  case "$verb" in
    done) echo "stub close note" | "$cli" close "$id" --done ;;
    dirty) echo "stub dirt for $id" > "$rest" ;;
  esac
done < "$control/$id"
