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

echo "Generating artifact-screened narration with direct Qwen3-TTS CustomVoice..."
uv run --script scripts/synthesize-demo-narration.py

NARRATION_RAW="video/build/narration-qwen3.wav"
NARRATION="video/build/narration-qwen3-master.wav"
SRT="video/signgate-demo.en.srt"
OUTPUT="video/build/signgate-demo.mp4"
LOUDNORM_STATS="$(mktemp)"
trap 'rm -f "$LOUDNORM_STATS"' EXIT

echo "Building one two-pass PCM narration master..."
ffmpeg -hide_banner -nostats -y \
  -i "$NARRATION_RAW" \
  -af "highpass=f=60:p=2,aresample=48000:resampler=swr:filter_size=64:phase_shift=10:linear_interp=false:exact_rational=true:filter_type=kaiser:kaiser_beta=12,loudnorm=I=-16:TP=-2.0:LRA=5:linear=true:print_format=json" \
  -f null - 2>"$LOUDNORM_STATS"

LOUDNORM_VALUES="$(node - "$LOUDNORM_STATS" <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const candidates = [...text.matchAll(/\{[\s\S]*?\}/g)]
  .map((match) => {
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  })
  .filter((value) => value && value.input_i !== undefined);
const stats = candidates[candidates.length - 1];
if (!stats) {
  console.error('Could not parse FFmpeg loudnorm analysis.');
  process.exit(1);
}
process.stdout.write([
  stats.input_i,
  stats.input_tp,
  stats.input_lra,
  stats.input_thresh,
  stats.target_offset,
].join('|'));
NODE
)"
IFS='|' read -r INPUT_I INPUT_TP INPUT_LRA INPUT_THRESH TARGET_OFFSET <<< "$LOUDNORM_VALUES"

ffmpeg -hide_banner -nostats -y \
  -i "$NARRATION_RAW" \
  -af "highpass=f=60:p=2,aresample=48000:resampler=swr:filter_size=64:phase_shift=10:linear_interp=false:exact_rational=true:filter_type=kaiser:kaiser_beta=12,loudnorm=I=-16:TP=-2.0:LRA=5:measured_I=${INPUT_I}:measured_TP=${INPUT_TP}:measured_LRA=${INPUT_LRA}:measured_thresh=${INPUT_THRESH}:offset=${TARGET_OFFSET}:linear=true" \
  -ac 1 -ar 48000 -c:a pcm_s24le \
  "$NARRATION"

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
    -c:a aac -b:a 192k -ar 48000 -t "$NARRATION_DURATION" -movflags +faststart \
    "$OUTPUT"
else
  ffmpeg -y \
    -i "$VIDEO" \
    -i "$NARRATION" \
    -i "$SRT" \
    -map 0:v:0 -map 1:a:0 -map 2:0 \
    -vf "setpts=${VIDEO_TIME_SCALE}*PTS" \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -ar 48000 \
    -c:s mov_text -metadata:s:s:0 language=eng -disposition:s:0 default \
    -t "$NARRATION_DURATION" -movflags +faststart \
    "$OUTPUT"
fi

ffmpeg -v error -i "$OUTPUT" -f null -
ffprobe -v error -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height \
  -of json "$OUTPUT"
echo "Built: $OUTPUT"
