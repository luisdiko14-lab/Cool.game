#!/usr/bin/env bash
set -euo pipefail

INPUT_EXE="${1:-dist/NeonSwarm/NeonSwarm.exe}"
OUTPUT_EXE="${2:-$INPUT_EXE}"
CERTIFICATE="${WINDOWS_CODESIGN_CERT:-}"
PASSWORD="${WINDOWS_CODESIGN_CERT_PASSWORD:-}"
TIMESTAMP_URL="${TIMESTAMP_URL:-http://timestamp.digicert.com}"
SIGNTOOL_PATH="${SIGNTOOL_PATH:-}"

if [[ $# -gt 2 ]]; then
  echo "Usage: $0 [input.exe] [output.exe]" >&2
  exit 2
fi

if [[ -z "$SIGNTOOL_PATH" ]] && ! command -v osslsigncode >/dev/null 2>&1; then
  echo "Error: osslsigncode is required to sign Windows executables." >&2
  exit 1
fi

if [[ -z "$CERTIFICATE" || ! -f "$CERTIFICATE" ]]; then
  echo "Error: set WINDOWS_CODESIGN_CERT to the path of your trusted .pfx certificate." >&2
  exit 1
fi

if [[ -z "$PASSWORD" ]]; then
  read -r -s -p "PFX password: " PASSWORD
  printf '\n'
fi

if [[ ! -f "$INPUT_EXE" ]]; then
  echo "Error: input executable not found: $INPUT_EXE" >&2
  exit 1
fi

TEMP_OUTPUT="$(mktemp "${OUTPUT_EXE}.tmp.XXXXXX")"
cleanup() {
  if [[ -n "$TEMP_OUTPUT" ]]; then
    rm -f -- "$TEMP_OUTPUT"
  fi
}
trap cleanup EXIT

echo "Signing $INPUT_EXE..."
if [[ -n "$SIGNTOOL_PATH" ]]; then
  "$SIGNTOOL_PATH" sign /fd SHA256 /tr "$TIMESTAMP_URL" /td SHA256 \
    /f "$CERTIFICATE" /p "$PASSWORD" /d "Neon Swarm" "$TEMP_OUTPUT"
  echo "Verifying signature..."
  "$SIGNTOOL_PATH" verify /pa /v "$TEMP_OUTPUT"
else
  osslsigncode sign \
    -pkcs12 "$CERTIFICATE" \
    -pass "$PASSWORD" \
    -ts "$TIMESTAMP_URL" \
    -in "$INPUT_EXE" \
    -out "$TEMP_OUTPUT"
  echo "Verifying signature..."
  osslsigncode verify -in "$TEMP_OUTPUT"
fi

mv -f -- "$TEMP_OUTPUT" "$OUTPUT_EXE"
TEMP_OUTPUT=""
echo "Done! Signed executable saved to: $OUTPUT_EXE"
