#!/usr/bin/env bash
# Records the Android emulator screen and turns it into ./demo.gif for the README.
#
#   ./scripts/record-demo.sh record [seconds]         # record the device screen (default 15s)
#   ./scripts/record-demo.sh gif [start] [duration]   # convert demo.mp4 -> demo.gif (trim optional)
#
# `adb screenrecord` captures only the device framebuffer, so there are no desktop
# borders or emulator chrome to crop. The GIF step tries progressively lighter
# settings (fps / width) until the file is under MAX_MB.
#
# Tips: run Metro with `npx expo start --no-dev --minify` (dev mode is too slow on the emulator
# for smooth streaming), and hide Expo Go's floating "Tools button" from its dev menu first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MP4="$ROOT/demo.mp4"
GIF="$ROOT/demo.gif"
MAX_MB="${MAX_MB:-10}"
# Optional ffmpeg crop (w:h:x:y) to drop the Android status/navigation bars, e.g. CROP=1080:2217:0:63
CROP="${CROP:-}"

ADB="${ADB:-$(command -v adb || echo "$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe")}"
FFMPEG="${FFMPEG:-$(command -v ffmpeg || python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')}"

record() {
  local secs="${1:-15}"
  "$ADB" get-state >/dev/null || { echo "No device/emulator connected." >&2; exit 1; }
  echo "Recording ${secs}s — perform the choreography on the emulator now..."
  # MSYS_NO_PATHCONV stops Git Bash from rewriting /sdcard into a Windows path.
  MSYS_NO_PATHCONV=1 "$ADB" shell screenrecord --time-limit "$secs" --bit-rate 8000000 /sdcard/demo.mp4
  local dest="$MP4"
  command -v cygpath >/dev/null && dest="$(cygpath -w "$MP4")" # adb.exe needs a Windows path
  MSYS_NO_PATHCONV=1 "$ADB" pull /sdcard/demo.mp4 "$dest"
  MSYS_NO_PATHCONV=1 "$ADB" shell rm /sdcard/demo.mp4
  echo "Saved $MP4"
}

to_gif() {
  local start="${1:-0}" dur="${2:-15}"
  [ -f "$MP4" ] || { echo "Missing $MP4 — run 'record' first." >&2; exit 1; }
  local fps width size
  for preset in "20 800" "15 800" "15 600" "12 600" "10 480"; do
    read -r fps width <<<"$preset"
    "$FFMPEG" -y -loglevel error -ss "$start" -t "$dur" -i "$MP4" \
      -vf "${CROP:+crop=$CROP,}fps=$fps,scale=$width:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
      -loop 0 "$GIF"
    size=$(wc -c <"$GIF")
    printf '%sfps @ %spx -> %.1f MB\n' "$fps" "$width" "$(awk "BEGIN{print $size/1048576}")"
    if [ "$size" -le $((MAX_MB * 1048576)) ]; then
      echo "Saved $GIF"
      return
    fi
  done
  echo "Still over ${MAX_MB}MB — shorten the clip or run it through ezgif.com/optimize." >&2
}

case "${1:-}" in
  record) record "${2:-}" ;;
  gif) to_gif "${2:-}" "${3:-}" ;;
  *) sed -n '2,5p' "$0"; exit 1 ;;
esac
