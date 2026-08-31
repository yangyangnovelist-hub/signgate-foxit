#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for cmd in node npm uv ffmpeg ffprobe curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

if [ ! -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  echo "Google Chrome was not found at the path expected by scripts/record-demo.mjs" >&2
  exit 1
fi

if ! curl -fsS --max-time 20 "${SIGNGATE_DEMO_URL:-https://signgate-foxit-production.up.railway.app/}api/status" >/dev/null; then
  echo "The public SignGate demo is unavailable." >&2
  exit 1
fi

mkdir -p video/build/browser

if [ "${SIGNGATE_SKIP_RECORDING:-0}" = "1" ]; then
  echo "Reusing the latest recorded judge flow..."
  VIDEO="$(find video/build/browser -type f -name '*.webm' -print0 | xargs -0 ls -t | head -n 1)"
else
  echo "Recording the public judge flow..."
  BEFORE_LIST="$(mktemp)"
  AFTER_LIST="$(mktemp)"
  find video/build/browser -type f -name '*.webm' -print | sort > "$BEFORE_LIST"
  node scripts/record-demo.mjs
  find video/build/browser -type f -name '*.webm' -print | sort > "$AFTER_LIST"
  VIDEO="$(comm -13 "$BEFORE_LIST" "$AFTER_LIST" | tail -n 1)"
  rm -f "$BEFORE_LIST" "$AFTER_LIST"
fi

if [ -z "${VIDEO:-}" ]; then
  VIDEO="$(find video/build/browser -type f -name '*.webm' -print0 | xargs -0 ls -t | head -n 1)"
fi
if [ -z "${VIDEO:-}" ] || [ ! -f "$VIDEO" ]; then
  echo "Could not locate the newly recorded browser video." >&2
  exit 1
fi

echo "Generating narration from reviewed cues..."
uv run --script scripts/synthesize-demo-narration.py

NARRATION="video/build/narration-kokoro.wav"
SRT="video/signgate-demo.en.srt"
OUTPUT="video/build/signgate-demo.mp4"
VIDEO_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")"
NARRATION_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$NARRATION")"
VIDEO_TIME_SCALE="$(awk -v video="$VIDEO_DURATION" -v narration="$NARRATION_DURATION" 'BEGIN { printf "%.9f", narration / video }')"

echo "Muxing narration and captions..."
if ffmpeg -hide_banner -filters 2>/dev/null | grep -qE '[[:space:]]subtitles[[:space:]]'; then
  ffmpeg -y \
    -i "$VIDEO" \
    -i "$NARRATION" \
    -vf "setpts=${VIDEO_TIME_SCALE}*PTS,subtitles=filename='${SRT}':force_style='FontName=Arial,FontSize=18,Outline=1,Shadow=0,MarginV=24'" \
    -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
    -c:a aac -b:a 160k -movflags +faststart -shortest \
    "$OUTPUT"
else
  ffmpeg -y \
    -i "$VIDEO" \
    -i "$NARRATION" \
    -i "$SRT" \
    -map 0:v:0 -map 1:a:0 -map 2:0 \
    -vf "setpts=${VIDEO_TIME_SCALE}*PTS" \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
    -c:a aac -b:a 160k \
    -c:s mov_text -metadata:s:s:0 language=eng -disposition:s:0 default \
    -movflags +faststart -shortest \
    "$OUTPUT"
fi

ffmpeg -v error -i "$OUTPUT" -f null -
ffprobe -v error -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height \
  -of json "$OUTPUT"
echo "Built: $OUTPUT"
