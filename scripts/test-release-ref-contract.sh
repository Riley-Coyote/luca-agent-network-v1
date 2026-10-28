#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
verify="${repo_root}/scripts/verify-release-ref.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q
git -C "$tmp" config user.name test
git -C "$tmp" config user.email test@example.com
echo first >"$tmp/file"
git -C "$tmp" add file
git -C "$tmp" commit -qm first
git -C "$tmp" tag v1.2.3

(
  cd "$tmp"
  GITHUB_REF=refs/tags/v1.2.3 "$verify" v 1.2.3
)

# Polyphonic's beta tags may be annotated; the guard must compare commits, not
# tag objects. These fixtures never create a tag in the product repository.
git -C "$tmp" tag -a v0.5.0-beta.14 -m 'beta fixture'
(
  cd "$tmp"
  GITHUB_REF=refs/tags/v0.5.0-beta.14 "$verify" v 0.5.0-beta.14
)

if (
  cd "$tmp"
  unset GITHUB_REF
  "$verify" v 1.2.3
); then
  echo "release without an explicit tag ref was accepted" >&2
  exit 1
fi

if (
  cd "$tmp"
  GITHUB_REF=refs/tags/v9.9.9 "$verify" v 9.9.9
); then
  echo "release without a local tag was accepted" >&2
  exit 1
fi

if (
  cd "$tmp"
  GITHUB_REF=refs/tags/vlatest "$verify" v latest
); then
  echo "release without a version number was accepted" >&2
  exit 1
fi

if (
  cd "$tmp"
  GITHUB_REF=refs/tags/v1.2.3 "$verify" v 0.5.0-beta.14
); then
  echo "release with a different version's tag was accepted" >&2
  exit 1
fi

if (
  cd "$tmp"
  GITHUB_REF=refs/heads/main "$verify" v 1.2.3
); then
  echo "branch-backed desktop release was accepted" >&2
  exit 1
fi

echo second >>"$tmp/file"
git -C "$tmp" commit -qam second
if (
  cd "$tmp"
  GITHUB_REF=refs/tags/v1.2.3 "$verify" v 1.2.3
); then
  echo "release accepted HEAD after the tag commit" >&2
  exit 1
fi

git -C "$tmp" tag relay-v2.0.0
(
  cd "$tmp"
  GITHUB_REF=refs/tags/relay-v2.0.0 "$verify" relay-v 2.0.0
)

# WP-30 removed the upstream Buzz workflows and automatic tagger. Test the
# reusable ref guard, not those retired publishers. Packaging and publication
# remain separate, owner-approved steps in desktop/release/README.md.

echo "release ref contract passed"
