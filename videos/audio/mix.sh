#!/usr/bin/env bash
# Mix narration + music under a rendered video.
# Usage: audio/mix.sh <video.mp4> <music.wav> <out.mp4> <clip@ms> [clip@ms ...]
set -euo pipefail
video=$1; music=$2; out=$3; shift 3
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
inputs=(); filters=""; labels=""; i=0
for spec in "$@"; do
  clip=${spec%@*}; ms=${spec#*@}
  inputs+=(-i "$clip")
  idx=$((i + 2))
  filters+="[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v$i];"
  labels+="[v$i]"; i=$((i + 1))
done
filters+="${labels}amix=inputs=$i:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[voice];"
filters+="[voice]asplit=2[vox][key];"
filters+="[1:a]volume=-9dB[mus];"
filters+="[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=450[duck];"
filters+="[duck][vox]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.9[aout]"
ffmpeg -y -loglevel error -i "$video" -i "$music" "${inputs[@]}" -filter_complex "$filters" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -ar 48000 -t "$dur" -movflags +faststart "$out"
