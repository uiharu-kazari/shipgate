#!/usr/bin/env bash
# Mux each scene's silent webm (video/clips/NN.webm) with its narration
# (video/audio/NN.mp3), trimming video to the audio length, then concatenate
# all scenes into video/shipgate-demo.mp4. Requires ffmpeg.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

list=build/concat.txt
: > "$list"
for a in audio/0*.mp3; do
  n=$(basename "$a" .mp3)
  v="clips/${n}.webm"
  [ -f "$v" ] || { echo "missing $v — run record.py first" >&2; exit 1; }
  ad=$(dur "$a")
  out="build/${n}.mp4"
  # scale/pad to exactly 1280x720, hold last video frame if shorter than audio,
  # cut to the audio duration, normalize to 30fps + AAC.
  ffmpeg -y -loglevel error \
    -i "$v" -i "$a" \
    -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,tpad=stop_mode=clone:stop_duration=3[v]" \
    -map "[v]" -map 1:a -t "$ad" \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest "$out"
  echo "file '${n}.mp4'" >> "$list"
  echo "built $out (${ad}s)"
done

ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" -c copy shipgate-demo.mp4
echo "== final: $(pwd)/shipgate-demo.mp4  ($(dur shipgate-demo.mp4)s) =="
