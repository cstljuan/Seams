"""Turn a capture folder (log.json + frames) into a constant 30 fps H.264 clip.

Usage: python3 scripts/assemble.py <captureDir> public/footage/prod-walkthrough.mp4
"""
import json
import subprocess
import sys

cap, out = sys.argv[1], sys.argv[2]
frames = json.load(open(f"{cap}/log.json"))["frames"]
with open(f"{cap}/concat.txt", "w") as f:
    for i, x in enumerate(frames):
        dur = frames[i + 1]["t"] - x["t"] if i + 1 < len(frames) else 1.0
        f.write(f"file '{x['file']}'\nduration {dur:.4f}\n")
    f.write(f"file '{frames[-1]['file']}'\n")
subprocess.run(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{cap}/concat.txt",
     "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", out],
    check=True,
)
