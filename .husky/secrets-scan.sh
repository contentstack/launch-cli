#!/bin/sh
set -eu

cd "$(git rev-parse --show-toplevel)"

for tool in git curl tar mktemp awk xargs uname tr dirname; do
  command -v "$tool" >/dev/null 2>&1 || { echo "secrets-scan: required tool '$tool' not found in PATH" >&2; exit 1; }
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo "secrets-scan: required tool 'sha256sum' or 'shasum' not found in PATH" >&2
  exit 1
fi

HOOK_NAME="$1"

TALISMAN_VERSION="v1.37.0"
TRUFFLEHOG_VERSION="3.96.0"
CACHE_DIR="$HOME/.cache/secrets-scan-tools"
mkdir -p "$CACHE_DIR"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH_RAW=$(uname -m)
case "$ARCH_RAW" in
  x86_64) ARCH=amd64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) ARCH="$ARCH_RAW" ;;
esac

# Pinned checksums (from https://github.com/thoughtworks/talisman/releases/download/v1.37.0/checksums
# and https://github.com/trufflesecurity/trufflehog/releases/download/v3.96.0/trufflehog_3.96.0_checksums.txt),
# committed here rather than fetched at runtime - the whole point is to not trust a checksums file
# downloaded from the same release as the binary it's meant to verify.
case "${OS}_${ARCH}" in
  darwin_amd64)
    TALISMAN_SHA256="9a67e015d6c99650c45d653ce4a597f885bf661164c2671f08a3827013b277fb"
    TRUFFLEHOG_SHA256="a30d8f1095e031a81a668e1582f2ed479c3b50476cef86317e0fb74210c33617"
    ;;
  darwin_arm64)
    TALISMAN_SHA256="4806746b2ba0190941f0606853990b4da6eb7df2d64c261212a6aa66eb6b15c2"
    TRUFFLEHOG_SHA256="87478306b95ca2420cfb844b7582383ac60b922e262350a0088e797f328d2e62"
    ;;
  linux_amd64)
    TALISMAN_SHA256="8e0ae8bb7b160bf10c4fa1448beb04a32a35e63505b3dddff74a092bccaaa7e4"
    TRUFFLEHOG_SHA256="7105f1cd6577f058a9e39d0578f1a99c8a1e481e4d3512cd8a09acfe22a0fdc0"
    ;;
  linux_arm64)
    TALISMAN_SHA256="ca706f428a45d7a4ed3cc5c3cf7b3e5b0dfce6f2f584000a117d0d602a0342b7"
    TRUFFLEHOG_SHA256="50acd4c7a3b8ebfe5083d8350956057030c44be3515dedd55b45263495c490b2"
    ;;
  *)
    echo "secrets-scan: no pinned checksum for platform ${OS}_${ARCH} (talisman ${TALISMAN_VERSION} / trufflehog ${TRUFFLEHOG_VERSION})" >&2
    exit 1
    ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
  checksum() { sha256sum "$1" | awk '{print $1}'; }
else
  checksum() { shasum -a 256 "$1" | awk '{print $1}'; }
fi

TALISMAN_BIN="$CACHE_DIR/talisman_${TALISMAN_VERSION}_${OS}_${ARCH}"
if [ ! -x "$TALISMAN_BIN" ]; then
  echo "secrets-scan: downloading Talisman ${TALISMAN_VERSION}..."
  curl -fsSL -o "${TALISMAN_BIN}.tmp" "https://github.com/thoughtworks/talisman/releases/download/${TALISMAN_VERSION}/talisman_${OS}_${ARCH}"
  ACTUAL_HASH=$(checksum "${TALISMAN_BIN}.tmp")
  if [ "$ACTUAL_HASH" != "$TALISMAN_SHA256" ]; then
    echo "secrets-scan: Talisman checksum verification FAILED" >&2
    rm -f "${TALISMAN_BIN}.tmp"
    exit 1
  fi
  mv "${TALISMAN_BIN}.tmp" "$TALISMAN_BIN"
  chmod +x "$TALISMAN_BIN"
fi

TRUFFLEHOG_DIR="$CACHE_DIR/trufflehog_${TRUFFLEHOG_VERSION}_${OS}_${ARCH}"
TRUFFLEHOG_BIN="$TRUFFLEHOG_DIR/trufflehog"
if [ ! -x "$TRUFFLEHOG_BIN" ]; then
  echo "secrets-scan: downloading trufflehog ${TRUFFLEHOG_VERSION}..."
  mkdir -p "$TRUFFLEHOG_DIR"
  TARBALL="$CACHE_DIR/trufflehog_${TRUFFLEHOG_VERSION}_${OS}_${ARCH}.tar.gz"
  curl -fsSL -o "$TARBALL" "https://github.com/trufflesecurity/trufflehog/releases/download/v${TRUFFLEHOG_VERSION}/trufflehog_${TRUFFLEHOG_VERSION}_${OS}_${ARCH}.tar.gz"
  ACTUAL_HASH=$(checksum "$TARBALL")
  if [ "$ACTUAL_HASH" != "$TRUFFLEHOG_SHA256" ]; then
    echo "secrets-scan: trufflehog checksum verification FAILED" >&2
    rm -f "$TARBALL"
    exit 1
  fi
  tar -xzf "$TARBALL" -C "$TRUFFLEHOG_DIR"
  chmod +x "$TRUFFLEHOG_BIN"
fi

case "$HOOK_NAME" in
  pre-commit)
    "$TALISMAN_BIN" --githook pre-commit

    STAGED_LIST=$(mktemp)
    STAGE_DIR=$(mktemp -d)
    trap 'rm -f "$STAGED_LIST"; rm -rf "$STAGE_DIR"' EXIT
    git diff --cached --name-only --diff-filter=ACM -z > "$STAGED_LIST"
    if [ -s "$STAGED_LIST" ]; then
      export STAGE_DIR
      xargs -0 sh -c 'for f; do mkdir -p "$STAGE_DIR/$(dirname "$f")"; git show ":$f" > "$STAGE_DIR/$f"; done' _ < "$STAGED_LIST"
      "$TRUFFLEHOG_BIN" filesystem --fail --no-update --results=verified,unverified,unknown "$STAGE_DIR"
    fi
    ;;
  pre-push)
    REMOTE_NAME="${2:-origin}"
    STDIN_DATA=$(cat)
    if [ -z "$STDIN_DATA" ]; then
      exit 0
    fi

    DEFAULT_REF=$(git symbolic-ref -q --short "refs/remotes/${REMOTE_NAME}/HEAD" 2>/dev/null || echo "")
    DEFAULT_BASE=""
    [ -n "$DEFAULT_REF" ] && DEFAULT_BASE=$(git rev-parse --verify "$DEFAULT_REF" 2>/dev/null || echo "")
    [ -z "$DEFAULT_BASE" ] && DEFAULT_BASE=$(git rev-parse --verify "${REMOTE_NAME}/main" 2>/dev/null || echo "")
    [ -z "$DEFAULT_BASE" ] && DEFAULT_BASE=$(git rev-parse --verify "${REMOTE_NAME}/master" 2>/dev/null || echo "")

    RESOLVED_STDIN=""
    while read -r LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA; do
      [ -z "$LOCAL_SHA" ] && continue
      [ "$LOCAL_SHA" = "0000000000000000000000000000000000000000" ] && continue
      if [ -z "$REMOTE_SHA" ] || [ "$REMOTE_SHA" = "0000000000000000000000000000000000000000" ]; then
        REMOTE_SHA="$DEFAULT_BASE"
      fi
      if [ -z "$REMOTE_SHA" ]; then
        echo "secrets-scan: could not determine a base commit to scan ${LOCAL_REF} against (no ${REMOTE_NAME}/HEAD, ${REMOTE_NAME}/main, or ${REMOTE_NAME}/master found locally) - refusing to silently skip the scan. Run 'git fetch ${REMOTE_NAME}' and try again." >&2
        exit 1
      fi
      RESOLVED_STDIN="${RESOLVED_STDIN}${LOCAL_REF} ${LOCAL_SHA} ${REMOTE_REF} ${REMOTE_SHA}
"
      "$TRUFFLEHOG_BIN" git "file://$(pwd)" --since-commit "$REMOTE_SHA" --branch "$LOCAL_SHA" --fail --no-update --results=verified,unverified,unknown
    done <<EOF
$STDIN_DATA
EOF

    if [ -n "$RESOLVED_STDIN" ]; then
      printf '%s' "$RESOLVED_STDIN" | "$TALISMAN_BIN" --githook pre-push
    fi
    ;;
  *)
    echo "secrets-scan: unknown hook '$HOOK_NAME'" >&2
    exit 1
    ;;
esac
