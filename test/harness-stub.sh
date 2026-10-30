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
# `trap`, if present, is run with sh when the stand-in is sent SIGTERM, before
# it exits, as a harness's own shutdown; `run`, if present, is run with sh in
# the working directory first, as a session's work, its output on stderr, and
# waited on in the background, so a trap need not wait for it to end;
# `answer`, if present, is then copied to the answer file; `stderr` and
# `stdout` are printed as they are, and `exit` holds the status, 0 if absent.
# The answer file is the path the answer instruction in stdin names, and `run`
# finds it in $ANSWER.
#
# An id with nothing under <control>/<id>/ when its first call comes takes the
# answers of the lowest-numbered session queued under <control>/queue/<k>/
# that no id has taken yet, so a test scripts sessions whose ids another
# process draws in the order they launch.
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

if [ ! -e "$HARNESS_STUB/$id" ]; then
  k=1
  while [ -e "$HARNESS_STUB/queue/$k" ]; do
    if [ -e "$HARNESS_STUB/queue/$k/answers" ]; then
      mkdir "$HARNESS_STUB/$id"
      mv "$HARNESS_STUB/queue/$k/answers" "$HARNESS_STUB/$id/answers"
      break
    fi
    k=$((k + 1))
  done
fi

calls="$HARNESS_STUB/$id/calls"
mkdir -p "$calls"
n=1
while [ -e "$calls/$n" ]; do n=$((n + 1)); done
mkdir "$calls/$n"
printf '%s\n' "$name" "$@" > "$calls/$n/argv"
cat > "$calls/$n/stdin"
pwd -P > "$calls/$n/cwd"
ANSWER=$(sed -n 's/^Write your report, .*, to `\([^`]*\)`, then respond with `done`\..*/\1/p' "$calls/$n/stdin" | tail -n 1)
export ANSWER

reply="$HARNESS_STUB/$id/answers/$n"
if [ -f "$reply/trap" ]; then trap 'sh "$reply/trap"; exit 143' TERM; fi
if [ -f "$reply/run" ]; then sh "$reply/run" >&2 & wait $!; fi
if [ -f "$reply/answer" ]; then cat "$reply/answer" > "$ANSWER"; fi
if [ -f "$reply/stderr" ]; then cat "$reply/stderr" >&2; fi
if [ -f "$reply/stdout" ]; then cat "$reply/stdout"; fi
if [ -f "$reply/exit" ]; then exit "$(cat "$reply/exit")"; fi
exit 0
