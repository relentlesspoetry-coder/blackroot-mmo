#!/usr/bin/env python3
"""Compose the Dark Woods music: original tracks rendered from scratch with a
small additive/physical-modelling synth (no samples), so every note here is
ours.

  python3 tools/compose_music.py out_dir

Writes WAVs; encode with ffmpeg afterwards (see the Makefile-ish note at the
bottom). Deterministic: the same seed renders the same track.

Instruments: a bowed/organ-ish pad (detuned harmonic stacks through a soft
low-pass), a plucked string (Karplus-Strong) for the lute lines, bells
(inharmonic sine partials), a sub drone, a low tom, and breath (filtered
noise swells). A synthetic-IR convolution reverb glues it together.
"""
import sys, math, wave, struct
import numpy as np

SR = 44100

def note(n):  # MIDI -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)

def env(n, a, d, s, r, sr=SR):
    """ADSR over n samples (a/d/r seconds, s level)."""
    t = np.arange(n) / sr
    e = np.ones(n) * s
    A = int(a * sr); D = int(d * sr); R = int(r * sr)
    if A > 0: e[:A] = np.linspace(0, 1, min(A, n))
    if D > 0 and A < n: seg = min(D, n - A); e[A:A + seg] = np.linspace(1, s, seg)
    if R > 0 and n - R > 0: e[n - R:] *= np.linspace(1, 0, R)
    return e

def lowpass(x, cutoff, sr=SR):
    """One-pole low-pass, vectorised via an IIR on chunks (scipy-free)."""
    rc = 1 / (2 * math.pi * cutoff); a = (1 / sr) / (rc + 1 / sr)
    y = np.empty_like(x); acc = 0.0
    # loop in blocks with numpy's cumulative trick is messy; a plain loop over
    # 8M samples is too slow, so use lfilter-like recursion on decimated blocks
    # of 64 via a first-order recurrence closed form.
    b = 1 - a
    n = len(x)
    # y[k] = a*x[k] + b*y[k-1] -> y[k] = sum_j a*b^(k-j) x[j]; do it blockwise.
    blk = 4096
    powers = b ** np.arange(blk + 1)
    for i in range(0, n, blk):
        xs = x[i:i + blk]; m = len(xs)
        # contribution of previous state
        ys = acc * powers[1:m + 1]
        # convolution of a*xs with b^k (causal), via cumulative form
        # compute with FFT for the block
        k = np.arange(m)
        kern = a * (b ** k)
        conv = np.fft.irfft(np.fft.rfft(xs, 2 * m) * np.fft.rfft(kern, 2 * m))[:m]
        ys = ys + conv
        y[i:i + m] = ys; acc = ys[-1]
    return y

def pad(freq, dur, vel=1.0, bright=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.4, 0.0, 0.4):            # three detuned voices
        f = freq * 2 ** (det / 1200 * 6)
        for h in range(1, 9):
            out += np.sin(2 * math.pi * f * h * t + h) / (h ** 1.4)
    out *= env(n, 1.2, 0.5, 0.85, 1.8)
    out = lowpass(out, 600 + 900 * bright)
    return out * vel * 0.04

def pluck(freq, dur, vel=1.0):
    """Karplus-Strong: a noise burst in a feedback delay line = plucked string."""
    n = int(dur * SR); L = int(SR / freq)
    rng = np.random.default_rng(int(freq * 100))
    buf = rng.uniform(-1, 1, L)
    out = np.zeros(n)
    # vectorised KS: fill period by period
    prev = buf.copy()
    pos = 0
    while pos < n:
        m = min(L, n - pos)
        out[pos:pos + m] = prev[:m]
        nxt = 0.5 * (prev + np.roll(prev, -1)) * 0.996
        prev = nxt; pos += m
    out *= env(n, 0.004, 0.1, 0.8, 0.35)
    out = lowpass(out, 1800)                 # take the pick's edge off
    return out * vel * 0.3

def bell(freq, dur, vel=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, dec in ((1, 1, 1.6), (2.76, 0.5, 0.9), (5.4, 0.25, 0.5), (8.9, 0.12, 0.3)):
        out += amp * np.sin(2 * math.pi * freq * ratio * t) * np.exp(-t / dec)
    return out * vel * 0.13 * np.minimum(1, t * 400)

def drone(freq, dur, vel=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    lfo = 1 + 0.02 * np.sin(2 * math.pi * 0.07 * t)
    out = np.sin(2 * math.pi * freq * t * lfo) + 0.35 * np.sin(2 * math.pi * freq * 2.005 * t) + 0.2 * np.sin(2 * math.pi * freq * 3.0 * t)
    return out * env(n, 3, 1, 1, 4) * vel * 0.028   # felt, not heard: the drone must never lead

def tom(dur=1.2, vel=1.0, f0=110):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f0 * np.exp(-t * 6) + 45
    ph = np.cumsum(2 * math.pi * f / SR)
    body = np.sin(ph) * np.exp(-t * 3.5)
    rng = np.random.default_rng(7)
    click = rng.uniform(-1, 1, n) * np.exp(-t * 60) * 0.4
    return (body + click) * vel * 0.3

def breath(dur, vel=1.0, seed=1):
    n = int(dur * SR); rng = np.random.default_rng(seed)
    x = rng.uniform(-1, 1, n)
    x = lowpass(x, 900) - lowpass(x, 300)      # a band of whisper
    t = np.arange(n) / SR
    swell = np.sin(math.pi * t / dur) ** 2
    return x * swell * vel * 0.16

def reverb(x, seconds=2.8, mix=0.32, seed=3):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR); t = np.arange(n) / SR
    ir = rng.uniform(-1, 1, n) * np.exp(-t * 3.0 / seconds * 2.2)
    ir[:int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))   # no direct spike
    ir = lowpass(ir, 3200)                 # a darker, further-away room
    ir /= np.max(np.abs(ir)) * 18
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n))[:len(x)]
    return x * (1 - mix) + wet * mix

def level(x, target=0.09, win=1.0, ceiling=0.6):
    """Keep the loudness flat: ride the gain so every second sits near the
    target RMS (slow, so it never pumps), then soft-clip anything left."""
    n = int(win * SR)
    rms = np.array([np.sqrt(np.mean(x[i:i + n] ** 2)) + 1e-6 for i in range(0, len(x), n)])
    g = target / rms
    g = np.minimum(g, 1.25)   # never boost quiet passages much — that turned the drone into a foghorn
    # smooth the gain curve over ~6 s so it breathes instead of pumping
    k = 6; g = np.convolve(np.pad(g, (k, k), mode='edge'), np.ones(2 * k + 1) / (2 * k + 1), mode='valid')
    gain = np.interp(np.arange(len(x)), np.arange(len(g)) * n + n / 2, g)
    y = x * gain
    y = y - lowpass(y, 45)     # nothing below ~45 Hz: no sub rumble sitting under everything
    return np.tanh(y / ceiling) * ceiling

def loopable(x, xf=8.0):
    """Crossfade the last xf seconds into the first xf seconds and trim, so the
    track loops without a seam; ease the very start so it never pops in."""
    n = int(xf * SR)
    head, tail = x[:n].copy(), x[-n:].copy()
    w = np.linspace(0, 1, n)
    x = x[:-n].copy()
    x[:n] = head * w + tail * (1 - w)
    x[:SR] *= np.linspace(0.3, 1, SR)
    return x

class Score:
    def __init__(self, bpm, bars, beats=4):
        self.bpm = bpm; self.spb = 60 / bpm; self.beats = beats
        self.n = int(bars * beats * self.spb * SR) + SR * 6
        self.buf = np.zeros(self.n)
    def at(self, bar, beat):
        return ((bar * self.beats) + beat) * self.spb
    def add(self, sig, t, gain=1.0):
        i = int(t * SR); m = min(len(sig), self.n - i)
        if m > 0: self.buf[i:i + m] += sig[:m] * gain

def write_wav(path, x):
    x = x / max(1e-6, np.max(np.abs(x))) * 0.7   # headroom: these are background pieces
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())

# ---------------------------------------------------------------------------
# Track 1 — "Under the Blackroot Boughs" (Dark Woods, day). D dorian, 74 bpm.
# Drone and pads under a lute motif that returns in variations; bells answer;
# a distant tom marks the darker turns.
# ---------------------------------------------------------------------------
def track_boughs():
    S = Score(74, 64)
    D = 50  # D3
    prog = [  # (root offset, chord intervals) per 2 bars
        (0, (0, 7, 14)), (0, (0, 7, 14)), (-2, (0, 7, 10)), (-2, (0, 7, 10)),   # Dm  Cmaj-ish (dorian colour)
        (-4, (0, 7, 14)), (-4, (0, 7, 14)), (-5, (0, 7, 15)), (-5, (0, 7, 15)),  # Bb  A(m)
    ]
    # drone through everything, swelling
    for k in range(0, 64, 16):
        S.add(drone(note(D), 16 * 4 * S.spb + 3, 0.9), S.at(k, 0))
    # pads: 2-bar chords, alternating brightness by section
    for cyc in range(4):
        for i, (ro, ints) in enumerate(prog):
            bar = cyc * 16 + i * 2
            bright = 0.45
            for it in ints:
                S.add(pad(note(D + ro + it + 12), 2 * 4 * S.spb + 1.5, 0.8, bright), S.at(bar, 0))
    # lute motif (dorian): phrases over 4 bars, entering at bar 8
    motif = [(0, 0, 1.0), (2, 0.75, 0.9), (3, 1.5, 0.8), (5, 2.0, 1.0), (7, 3.0, 0.9), (5, 3.5, 0.7),
             (3, 4.0, 0.9), (2, 5.0, 0.8), (0, 5.5, 1.0), (-2, 6.5, 0.8), (0, 7.5, 0.9)]
    variants = [
        motif,
        [(n + 7, b, v) for (n, b, v) in motif],                         # up a fifth
        [(n, b, v * 0.8) for (n, b, v) in motif[:6]] + [(9, 4.5, 0.9), (7, 5.5, 0.9), (5, 6.5, 0.8), (3, 7.5, 1.0)],
        [(12, 0, 1.0), (10, 1.0, 0.9), (7, 2.0, 0.9), (5, 3.0, 0.8), (3, 4.0, 1.0), (2, 5.0, 0.8), (0, 6.0, 1.0), (-5, 7.0, 0.7)],
    ]
    scale = {0: 0, 2: 2, 3: 3, 5: 5, 7: 7, 9: 9, 10: 10, 12: 12, -2: -2, -5: -5}
    lute_bars = [8, 12, 24, 28, 32, 36, 40, 44, 56, 60]
    for j, bar in enumerate(lute_bars):
        var = variants[j % len(variants)]
        for (n, b, v) in var:
            S.add(pluck(note(D + 12 + scale.get(n, n)), 2.2, v * 0.9), S.at(bar, b))
    # bells answering in the pad-only sections
    rng = np.random.default_rng(11)
    for bar in list(range(16, 24)) + list(range(48, 56)):
        for beat in (0, 2.5):
            if rng.random() < 0.6:
                n = rng.choice([0, 2, 3, 5, 7, 9, 12])
                S.add(bell(note(D + 24 + n), 3.0, 0.7), S.at(bar, beat))
    # distant tom on the darker chords (Bb / A) and a breath now and then
    for cyc in range(4):
        for i in (4, 5, 6, 7):
            bar = cyc * 16 + i * 2
            S.add(tom(1.4, 0.3), S.at(bar, 0))
            if i == 6: S.add(tom(1.0, 0.35, 90), S.at(bar, 2.5))
    for k in range(0, 64, 8):
        S.add(breath(6, 0.7, seed=k + 1), S.at(k, 2))
    return loopable(level(reverb(S.buf, 4.0, 0.45)))

# ---------------------------------------------------------------------------
# Track 2 — "Hollow Lantern" (Dark Woods, night). E aeolian/phrygian, 62 bpm.
# Slower and sparser: sub drone, hollow pads, a bell figure that keeps
# turning, and a lute that only speaks in the last third.
# ---------------------------------------------------------------------------
def track_lantern():
    S = Score(62, 56)
    E = 52
    prog = [(0, (0, 7, 12)), (0, (0, 7, 12)), (1, (0, 7, 12)), (1, (0, 7, 12)),   # Em  F (phrygian)
            (-4, (0, 7, 12)), (-4, (0, 7, 12)), (-2, (0, 7, 12)), (-2, (0, 7, 12))]  # C   D
    for k in range(0, 56, 14):
        S.add(drone(note(E), 14 * 4 * S.spb + 3, 0.9), S.at(k, 0))
    for cyc in range(4):
        for i, (ro, ints) in enumerate(prog):
            bar = cyc * 14 + i * 2
            if bar >= 56: break
            for it in ints:
                S.add(pad(note(E + ro + it + 12), 2 * 4 * S.spb + 2.0, 0.7, 0.3), S.at(bar, 0))
    fig = [(12, 0, 1.0), (11, 1.5, 0.7), (7, 2.5, 0.8), (8, 3.5, 0.6)]   # E B... with the phrygian F (8 = C? keep b2 colour via 13)
    fig2 = [(12, 0, 0.9), (13, 1.0, 0.6), (12, 2.0, 0.8), (7, 3.0, 0.7)]
    for bar in range(4, 52, 2):
        f = fig if (bar // 2) % 2 == 0 else fig2
        for (n, b, v) in f:
            S.add(bell(note(E + 12 + n), 3.5, v * 0.8), S.at(bar, b))
    lute = [(0, 0, 1.0), (3, 1.0, 0.9), (5, 2.0, 0.9), (7, 3.0, 1.0), (5, 4.5, 0.8), (3, 5.5, 0.9), (0, 6.5, 1.0), (-1, 7.5, 0.7)]
    for bar in (36, 40, 44, 48):
        for (n, b, v) in lute:
            S.add(pluck(note(E + n), 2.4, v * 0.8), S.at(bar, b))
    for cyc in range(4):
        for i in (4, 6):
            bar = cyc * 14 + i * 2
            if bar < 56: S.add(tom(1.6, 0.4, 95), S.at(bar, 0))
    for k in range(2, 56, 9):
        S.add(breath(7, 0.8, seed=k + 40), S.at(k, 0))
    return loopable(level(reverb(S.buf, 5.0, 0.5)))

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    for name, fn in (('darkwoods_boughs', track_boughs), ('darkwoods_lantern', track_lantern)):
        print('rendering', name); x = fn(); write_wav(f'{out}/{name}.wav', x); print('  ', round(len(x) / SR, 1), 's')
    # encode:  ffmpeg -i darkwoods_boughs.wav -codec:a libmp3lame -q:a 3 darkwoods_boughs.mp3
