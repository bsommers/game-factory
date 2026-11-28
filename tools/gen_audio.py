#!/usr/bin/env python3
"""Procedural sfx / ambience / music synth (numpy only, deterministic seed). Example set: FPS (shot, hit, pickup, hurt, boss roar, win, 3 ambience beds, music loop).

Writes 16-bit mono 44.1 kHz WAV files. Usage: python3 tools/gen_audio.py [--out assets/audio] [--only name,name]
Copy this file into a game and edit the `sfx` table in main(); keep recipes as small pure functions returning float arrays.
Agents cannot listen: validate peaks/RMS, a human reviews feel.
"""
import os
import wave

import numpy as np

SR = 44100
import sys
_A = sys.argv[1:]
OUT = _A[_A.index("--out") + 1] if "--out" in _A else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "audio")
ONLY = set(_A[_A.index("--only") + 1].split(",")) if "--only" in _A else None
RNG = np.random.default_rng(1337)


# ---------- helpers ----------

def t_axis(seconds):
    return np.arange(int(round(seconds * SR))) / SR


def env_exp(t, decay):
    return np.exp(-decay * t)


def env_attack_release(n, attack=0.005, release=0.05):
    e = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e[:a] = np.linspace(0.0, 1.0, a)
    e[-r:] *= np.linspace(1.0, 0.0, r)
    return e


def sweep(f0, f1, seconds, shape=1.0):
    """Phase-accumulated sine sweep from f0 to f1 (Hz)."""
    t = t_axis(seconds)
    x = np.clip(t / seconds, 0.0, 1.0) ** shape
    freq = f0 + (f1 - f0) * x
    phase = 2 * np.pi * np.cumsum(freq) / SR
    return np.sin(phase)


def lowpass(x, cutoff):
    """Brick-wall FFT lowpass (keeps loops periodic)."""
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    spec[freqs > cutoff] = 0
    return np.fft.irfft(spec, len(x))


def bandpass_noise(n, lo, hi):
    """Band-limited white noise via FFT masking (periodic over n samples)."""
    spec = np.fft.rfft(RNG.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1 / SR)
    mask = (freqs >= lo) & (freqs <= hi)
    spec[~mask] = 0
    out = np.fft.irfft(spec, n)
    return out / (np.max(np.abs(out)) + 1e-9)


def normalize(x, peak=0.9):
    m = np.max(np.abs(x))
    return x if m == 0 else x * (peak / m)


def soft_clip(x, drive=2.0):
    return np.tanh(drive * x) / np.tanh(drive)


def write_wav(name, x):
    path = os.path.join(OUT, name + ".wav")
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"wrote {path} ({len(x) / SR:.2f}s)")


def note_freq(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# ---------- sound effects ----------

def sfx_shot():
    d = 0.28
    t = t_axis(d)
    zap = sweep(1400, 180, d, shape=0.6) * env_exp(t, 9)
    crack = RNG.standard_normal(len(t)) * env_exp(t, 60)
    return normalize(zap + 0.5 * bandpass_noise(len(t), 1500, 6000) * env_exp(t, 30) + 0.3 * crack)


def sfx_hit():
    d = 0.14
    t = t_axis(d)
    thump = np.sin(2 * np.pi * (180 - 90 * t / d) * t) * env_exp(t, 22)
    click = bandpass_noise(len(t), 800, 5000) * env_exp(t, 90)
    return normalize(soft_clip(thump + 0.7 * click, 1.5))


def sfx_rat_squeak():
    d = 0.2
    t = t_axis(d)
    vib = 1 + 0.03 * np.sin(2 * np.pi * 45 * t)
    base = 3400 + 900 * np.sin(np.pi * t / d)
    carrier = np.sin(2 * np.pi * np.cumsum(base * vib) / SR)
    mod = np.sin(2 * np.pi * 1210 * t) * 0.4
    e = env_attack_release(len(t), 0.005, 0.06)
    return normalize(carrier * e + 0.15 * mod * e)


def sfx_pickup():
    notes = [84, 88, 91, 96]  # C6 E6 G6 C7
    step = 0.09
    total = 0.55
    out = np.zeros(int(total * SR))
    for i, m in enumerate(notes):
        start = int(i * step * SR)
        d = total - i * step
        t = t_axis(d)
        tone = np.sin(2 * np.pi * note_freq(m) * t) + 0.3 * np.sin(2 * np.pi * 2 * note_freq(m) * t)
        tone *= env_exp(t, 6)
        out[start:start + len(t)] += tone[: len(out) - start] * 0.6
    return normalize(out)


def sfx_geiger_tick():
    d = 0.03
    t = t_axis(d)
    click = bandpass_noise(len(t), 2000, 9000) * env_exp(t, 160)
    return normalize(click, 0.7)


def sfx_hurt():
    d = 0.38
    t = t_axis(d)
    tone = sweep(320, 110, d, shape=0.8)
    grit = np.sign(tone) * np.abs(tone) ** 0.7
    noise = bandpass_noise(len(t), 300, 3000) * 0.5
    e = env_attack_release(len(t), 0.003, 0.12)
    return normalize(soft_clip((grit + noise) * e, 2.5))


def sfx_boss_roar():
    d = 1.9
    t = t_axis(d)
    vib = 1 + 0.02 * np.sin(2 * np.pi * 5.5 * t)
    f = 62 * (1 + 0.25 * np.sin(np.pi * t / d)) * vib
    phase = 2 * np.pi * np.cumsum(f) / SR
    saw = sum(np.sin(k * phase) / k for k in range(1, 9)) * (2 / np.pi)
    grow = bandpass_noise(len(t), 150, 1200)
    env = np.minimum(1, t / 0.15) * (np.exp(-1.4 * t) * 0.7 + 0.3 * (t < d * 0.7))
    env *= np.linspace(1, 0.0, len(t)) ** 0.5
    return normalize(soft_clip((saw + 0.9 * grow) * env, 2.5))


def sfx_rescue():
    # Happy major arpeggio then a held chord.
    seq = [72, 76, 79, 84, 79, 84]  # C5 E5 G5 C6 G5 C6
    step = 0.13
    total = 1.7
    out = np.zeros(int(total * SR))
    for i, m in enumerate(seq):
        start = int(i * step * SR)
        d = total - i * step
        t = t_axis(d)
        tone = np.sin(2 * np.pi * note_freq(m) * t) + 0.4 * np.sin(2 * np.pi * note_freq(m) * 2 * t)
        tone *= env_exp(t, 4 if i < len(seq) - 1 else 2.5)
        out[start:start + len(t)] += tone[: len(out) - start] * 0.45
    t = t_axis(total)
    chord_start = int(0.8 * SR)
    tc = t_axis(total - 0.8)
    chord = sum(np.sin(2 * np.pi * note_freq(m) * tc) for m in (72, 76, 79, 84)) * env_exp(tc, 3.0)
    out[chord_start:chord_start + len(tc)] += chord[: len(out) - chord_start] * 0.22
    return normalize(out)


def sfx_win():
    # Brassy fanfare: C major, rising, ending on a sustained chord.
    phrase = [(67, 0.22), (72, 0.22), (76, 0.22), (79, 0.45), (76, 0.22), (79, 0.22), (84, 1.2)]
    total = sum(d for _, d in phrase) + 1.0
    out = np.zeros(int(total * SR))
    cursor = 0.0
    for m, d in phrase:
        n = int((d + 0.3) * SR)
        t = t_axis(d + 0.3)
        f = note_freq(m)
        saw = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 6))
        e = env_attack_release(len(t), 0.02, 0.25)
        note = soft_clip(saw * e * env_exp(t, 1.2), 1.8)
        s = int(cursor * SR)
        out[s:s + n] += note[: len(out) - s] * 0.35
        cursor += d
    tc = t_axis(1.0)
    s = int(cursor * SR)
    chord = sum(np.sin(2 * np.pi * note_freq(m) * tc) for m in (72, 76, 79, 84)) * env_exp(tc, 1.8)
    out[s:s + len(tc)] += chord[: len(out) - s] * 0.25
    return normalize(out)


# ---------- ambience beds (exactly periodic over their length) ----------

def amb_wind_desert():
    d = 12.0
    n = int(d * SR)
    base = bandpass_noise(n, 80, 2200)
    gust = 0.55 + 0.45 * np.sin(2 * np.pi * (np.arange(n) / n) * 2)  # two gusts per loop
    gust += 0.15 * np.sin(2 * np.pi * (np.arange(n) / n) * 5 + 1.1)
    grit = bandpass_noise(n, 2500, 5000) * 0.08
    return normalize(base * gust + grit, 0.55)


def amb_bunker_hum():
    d = 12.0
    t = t_axis(d)
    hum = sum(np.sin(2 * np.pi * 50 * k * t) / k ** 1.3 for k in range(1, 7))
    hum *= 0.5 + 0.02 * np.sin(2 * np.pi * 1 * t)  # 1 Hz wobble, integer over 12 s loop
    rumble = bandpass_noise(len(t), 30, 180) * 0.35
    air = bandpass_noise(len(t), 400, 900) * 0.05
    return normalize(hum + rumble + air, 0.5)


def amb_city_wind():
    d = 12.0
    n = int(d * SR)
    body = bandpass_noise(n, 200, 3500)
    k = np.arange(n) / n
    gust = np.clip(0.35 + 0.65 * np.sin(2 * np.pi * k * 3) ** 2, 0, 1)  # three gusts per loop
    siren = np.sin(2 * np.pi * 480 * np.arange(n) / SR) * 0.02 * (k > 0.6)  # faint, periodic
    return normalize(body * gust + siren, 0.5)


# ---------- music loop ----------

def music_loop():
    """30 s tense A-minor synth loop: 15 bars of 4 beats at 120 bpm."""
    beat = 0.5
    bars = 15
    total = bars * 4 * beat
    n = int(total * SR)
    out = np.zeros(n)
    progression = [(57, [57, 60, 64]),  # Am
                   (53, [53, 57, 60]),  # F
                   (48, [48, 52, 55]),  # C
                   (55, [55, 59, 62])]  # G
    for bar in range(bars):
        root, chord = progression[bar % 4]
        bar_start = bar * 4 * beat
        # Bass on every beat, low saw, short decay.
        for b in range(4):
            s = int((bar_start + b * beat) * SR)
            d = beat * 0.9
            t = t_axis(d)
            f = note_freq(root - 12 + (12 if b == 3 and bar % 2 else 0))
            bass = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 6))
            bass *= env_exp(t, 3.5) * 0.45
            out[s:s + len(t)] += bass[: n - s]
        # Arpeggio on eighth notes cycling the chord tones an octave up, detuned pulse.
        for e8 in range(8):
            s = int((bar_start + e8 * beat / 2) * SR)
            m = chord[e8 % 3] + 12
            d = beat / 2 * 0.95
            t = t_axis(d)
            f = note_freq(m)
            pulse = np.sign(np.sin(2 * np.pi * f * t)) * 0.5 + np.sin(2 * np.pi * f * 1.004 * t) * 0.5
            arp = pulse * env_exp(t, 7) * 0.12
            out[s:s + len(t)] += arp[: n - s]
        # Dissonant minor-second drone pad on bar starts for tension.
        s = int(bar_start * SR)
        d = 4 * beat
        t = t_axis(d)
        pad_root = note_freq(chord[0] + 12)
        pad = np.sin(2 * np.pi * pad_root * t) + np.sin(2 * np.pi * pad_root * 1.0293 * t)
        pad *= env_attack_release(len(t), 0.25, 0.4) * 0.09
        out[s:s + len(t)] += pad[: n - s]
    # Tension stinger: sparse high minor-second on bars 4, 8, 12.
    for bar in (4, 8, 12):
        s = int(bar * 4 * beat * SR)
        d = 0.6
        t = t_axis(d)
        stab = np.sin(2 * np.pi * note_freq(77) * t) + np.sin(2 * np.pi * note_freq(76) * t)
        stab *= env_exp(t, 4) * 0.12
        out[s:s + len(t)] += stab[: n - s]
    return normalize(soft_clip(out, 1.2), 0.6)


def main():
    os.makedirs(OUT, exist_ok=True)
    sfx = {
        "shot": sfx_shot,
        "hit": sfx_hit,
        "rat_squeak": sfx_rat_squeak,
        "pickup": sfx_pickup,
        "geiger_tick": sfx_geiger_tick,
        "hurt": sfx_hurt,
        "boss_roar": sfx_boss_roar,
        "rescue": sfx_rescue,
        "win": sfx_win,
        "wind_desert": amb_wind_desert,
        "bunker_hum": amb_bunker_hum,
        "city_wind": amb_city_wind,
        "music": music_loop,
    }
    for name, fn in sfx.items():
        if ONLY and name not in ONLY:
            continue
        write_wav(name, fn())


if __name__ == "__main__":
    main()
