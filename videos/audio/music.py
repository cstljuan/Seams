"""Original background score for the Seams film. Pure code, no samples, no licence needed.

Deterministic: same output every run. Chords change on the film's scene cuts, a soft
swell marks each seam wipe, and it resolves on the logo.
Usage: python3 audio/music.py <out.wav> <seconds> [film|opener]
"""
import sys
import wave

import numpy as np

SR = 48000
out, dur = sys.argv[1], float(sys.argv[2])
mode = sys.argv[3] if len(sys.argv) > 3 else "film"
n = int(SR * dur)
t = np.arange(n) / SR
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def lowpass(x, cutoff):
    # One-pole low-pass, run forwards (vectorised via cumulative filter is overkill; loop in chunks).
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(0, len(x), 4096):
        seg = x[i:i + 4096]
        o = np.empty_like(seg)
        for j, v in enumerate(seg):
            acc = (1 - a) * v + a * acc
            o[j] = acc
        y[i:i + 4096] = o
    return y


# Scene map (seconds) and chords (MIDI notes). D major colour, calm and open.
if mode == "film":
    sections = [
        (0.0, 8.0, [50, 57, 62, 66, 69]),      # Dadd9-ish: D A D F# A
        (8.0, 20.0, [47, 54, 59, 62, 66]),     # Bm: B F# B D F#
        (20.0, 35.0, [43, 50, 55, 59, 62, 66]),  # Gmaj7
        (35.0, 50.67, [40, 52, 55, 59, 62]),   # Em7
        (50.67, 68.0, [45, 52, 57, 61, 64]),   # A (lift for the number)
        (68.0, 81.0, [47, 54, 57, 62, 66]),    # Bm7
        (81.0, 90.0, [38, 50, 57, 62, 66, 69, 76]),  # D, wide, resolve
    ]
    cuts = [8.0, 20.0, 50.67, 68.0, 81.0]
    pulse_from, pulse_to = 20.0, 81.0
else:
    sections = [
        (0.0, 7.0, [50, 57, 62, 66, 69]),
        (7.0, 13.0, [43, 50, 55, 59, 62, 66]),
        (13.0, 18.0, [38, 50, 57, 62, 66, 69, 76]),
    ]
    cuts = [7.0, 13.0]
    pulse_from, pulse_to = 7.0, 13.0

pad = np.zeros(n)
for start, end, notes in sections:
    s0, s1 = int(start * SR), min(n, int((end + 1.2) * SR))  # overlap for crossfade
    tt = t[s0:s1] - start
    env = np.minimum(1, tt / 1.2) * np.clip((end + 1.2 - start - tt) / 1.2, 0, 1)
    chunk = np.zeros(s1 - s0)
    for k, m in enumerate(notes):
        f = hz(m)
        for det in (-0.12, 0.0, 0.12):  # gentle chorus
            ph = rng.uniform(0, 2 * np.pi)
            chunk += np.sin(2 * np.pi * f * (1 + det / 100) * tt + ph) * (0.6 if m < 50 else 0.35)
            chunk += 0.12 * np.sin(2 * np.pi * 2 * f * (1 + det / 100) * tt + ph)
    # slow breathing on the pad
    chunk *= env * (0.85 + 0.15 * np.sin(2 * np.pi * tt / 6.0))
    pad[s0:s1] += chunk
pad /= np.max(np.abs(pad)) + 1e-9

# Soft plucked pulse (eighth notes at 96 BPM) during the product and proof scenes.
pulse = np.zeros(n)
step = 60 / 96 / 2
k = 0
cur = pulse_from
while cur < pulse_to:
    sec = next(s for s in sections if s[0] <= cur < s[1])
    notes = sec[2]
    m = notes[[2, 3, 4, 3][k % 4] % len(notes)] + 12
    f = hz(m)
    s0 = int(cur * SR)
    L = min(n - s0, int(0.9 * SR))
    tt = np.arange(L) / SR
    vel = 0.55 if k % 4 == 0 else 0.35
    pulse[s0:s0 + L] += vel * np.exp(-tt * 6) * (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt))
    cur += step
    k += 1
# fade the pulse in and out
pe = np.clip((t - pulse_from) / 2, 0, 1) * np.clip((pulse_to - t) / 2, 0, 1)
pulse *= pe
pulse /= np.max(np.abs(pulse)) + 1e-9

# Swell into each seam cut: filtered noise rising for 1.2 s, gone right after the cut.
swell = np.zeros(n)
noise = rng.standard_normal(n)
for c in cuts:
    s0, s1 = int((c - 1.2) * SR), min(n, int((c + 0.25) * SR))
    tt = t[s0:s1] - (c - 1.2)
    env = np.where(tt < 1.2, (tt / 1.2) ** 2, np.clip(1 - (tt - 1.2) / 0.25, 0, 1))
    swell[s0:s1] += noise[s0:s1] * env
swell = lowpass(swell, 1800)
swell /= np.max(np.abs(swell)) + 1e-9

# Low sub note on each section root.
sub = np.zeros(n)
for start, end, notes in sections:
    s0, s1 = int(start * SR), min(n, int(end * SR))
    tt = t[s0:s1] - start
    env = np.minimum(1, tt / 0.8) * np.clip((end - start - tt) / 0.5, 0, 1)
    sub[s0:s1] += np.sin(2 * np.pi * hz(notes[0] - 12) * tt) * env

mix = 0.55 * pad + 0.22 * pulse + 0.18 * swell + 0.25 * sub
# Global fades: in over 1.5 s, out over the last 2.5 s.
mix *= np.clip(t / 1.5, 0, 1) * np.clip((dur - t) / 2.5, 0, 1)
# Stereo: pad slightly wide, pulse alternates a little.
left = mix + 0.04 * pulse * np.sin(2 * np.pi * t / 4)
right = mix - 0.04 * pulse * np.sin(2 * np.pi * t / 4)
st = np.stack([left, right], axis=1)
st /= np.max(np.abs(st)) + 1e-9
st *= 0.7
pcm = (st * 32767).astype(np.int16)
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(out, dur, mode)
