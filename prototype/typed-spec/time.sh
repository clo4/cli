#!/bin/sh
# Usage: ./time.sh <fn> [lib]  — times none/all/use at 20 and 40 commands
T=../../node_modules/.bin/tsc
fn=$1; lib=${2:-../lib.ts}
for kind in ${KINDS:-none all use}; do for n in ${NS:-20 40}; do
  node gen.mjs t $n $kind $lib $fn
  out=$( { /usr/bin/time -p timeout 90 $T -p big/tsconfig.t.json --extendedDiagnostics; } 2>&1 )
  printf "%s %s n=%s: %ss, %s instantiations, %s errors\n" "$fn" "$kind" "$n" "$(echo "$out" | awk '/^real/{print $2}')" "$(echo "$out" | awk '/Instantiations/{print $2}')" "$(echo "$out" | grep -c 'error TS')"
done; done
