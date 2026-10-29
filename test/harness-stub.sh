#!/bin/sh
# Stands in for Claude Code and Pi, so the tests launch and resume role
# sessions without a model. The tests link it onto PATH as `claude` and `pi`,
# and set HARNESS_STUB to a control directory and HARNESS_STUB_PATH to the PATH
# its own commands need, since the test's PATH holds only the stand-ins.
#
# Each call is keyed by the session id after `--session-id` or `--resume`, and
# numbered from 1 per id. Call <n> records its argv (the name it ran as first,
# one per line), its stdin and its working directory under
# <control>/<id>/calls/<n>/, then answers from <control>/<id>/answers/<n>/:
# `stderr` and `stdout` are printed as they are, and `exit` holds the status,
# 0 if absent.
set -eu
PATH="$HARNESS_STUB_PATH"
name="${0##*/}"

id=""
previous=""
for arg in "$@"; do
  case "$previous" in
    --session-id | --resume) id="$arg" ;;
  esac
  previous="$arg"
done

calls="$HARNESS_STUB/$id/calls"
mkdir -p "$calls"
n=1
while [ -e "$calls/$n" ]; do n=$((n + 1)); done
mkdir "$calls/$n"
printf '%s\n' "$name" "$@" > "$calls/$n/argv"
cat > "$calls/$n/stdin"
pwd -P > "$calls/$n/cwd"

answer="$HARNESS_STUB/$id/answers/$n"
if [ -f "$answer/stderr" ]; then cat "$answer/stderr" >&2; fi
if [ -f "$answer/stdout" ]; then cat "$answer/stdout"; fi
if [ -f "$answer/exit" ]; then exit "$(cat "$answer/exit")"; fi
exit 0
