#!/usr/bin/env bash
# Reuse the verified candidate workflow with a distinct closed identity.
# No installed-app replacement, release, automatic capture or new credentials.
set -euo pipefail
export POLYPHONIC_COMPANION_CANDIDATE_KIND=initiative
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/build-companion-delegation-candidate.sh" "$@"
