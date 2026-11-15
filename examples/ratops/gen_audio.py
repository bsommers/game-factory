#!/usr/bin/env python3
"""Procedural audio generator for RAT OPS. Deterministic (fixed seeds). numpy only.
usage: python3 tools/gen_audio.py [outdir]   (default game/assets/audio)
Writes sfx/*.wav, amb/*.wav (loops), music/*.wav (loops) and manifest.json (peak/rms dBFS)."""
import json, os, sys, wave, zlib
import numpy as np

SR = 32000
OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else os.path.join(os.path.dirname(__file__), "..", "game", "assets", "audio")


def rng(name):
    return np.random.default_rng(zlib.crc32(name.encode()))


def t_(d):
    return np.arange(int(d * SR)) / SR


def env(n, a=0.002, d=0.1, kind="exp"):
    t = np.arange(n) / SR
    e = np.exp(-t / max(d, 1e-4))
    att = np.minimum(1.0, t / max(a, 1e-4))
    return e * att


def noise(r, n):
    return r.standard_normal(n)


def fft_filter(x, lo=None, hi=None):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** 4)
    if hi:
        m *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * m, len(x))


def lp(x, hi):
    return fft_filter(x, None, hi)


def bp(x, lo, hi):
    return fft_filter(x, lo, hi)


def sine(f, d, ph=0.0):
    t = t_(d)
    return np.sin(2 * np.pi * (f * t if np.isscalar(f) else np.cumsum(f) / SR) + ph)


def sweep(f0, f1, d, curve=1.0):
    t = np.linspace(0, 1, int(d * SR))
    f = f0 + (f1 - f0) * t ** curve
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def add(buf, sig, at, gain=1.0, wrap=False):
    i = int(at * SR)
    if wrap:
        idx = (np.arange(len(sig)) + i) % len(buf)
        np.add.at(buf, idx, sig * gain)
    else:
        n = max(0, min(len(sig), len(buf) - i))
        buf[i:i + n] += sig[:n] * gain
    return buf


def reverb(x, tail=0.35, mix=0.25, seed=1):
    r = np.random.default_rng(seed)
    n = int(tail * SR)
    ir = r.standard_normal(n) * np.exp(-np.arange(n) / (tail * SR / 5))
    ir = lp(ir, 5000)
    y = np.convolve(x, ir / np.sqrt(np.sum(ir ** 2)), mode="full")[:len(x) + n // 2]
    out = np.zeros(len(y)); out[:len(x)] += x * (1 - mix)
    return out + y * mix * 0.6


def mix(*sigs):
    n = max(len(x) for x in sigs); o = np.zeros(n)
    for x in sigs:
        o[:len(x)] += x
    return o


def fade(x, ms=4):
    n = int(ms / 1000 * SR)
    x = x.copy(); x[:n] *= np.linspace(0, 1, n); x[-n:] *= np.linspace(1, 0, n)
    return x


def softclip(x, drive=1.5):
    return np.tanh(x * drive) / np.tanh(drive)


# ---------------------------------------------------------------- sfx recipes
def footstep(surface, v):
    r = rng(f"step_{surface}_{v}")
    p = 0.85 + 0.1 * v
    if surface == "stone":
        d = 0.18; n = int(d * SR)
        s = bp(noise(r, n), 300, 3500) * env(n, 0.001, 0.025) + sine(110 * p, d) * env(n, 0.001, 0.04) * 0.6
        s += bp(noise(r, n), 2500, 7000) * env(n, 0.0005, 0.008) * 0.4
    elif surface == "wood":
        d = 0.2; n = int(d * SR)
        s = sine(170 * p, d) * env(n, 0.001, 0.05) * 0.8 + sine(310 * p, d) * env(n, 0.001, 0.025) * 0.4
        s += lp(noise(r, n), 1800) * env(n, 0.001, 0.02) * 0.6
    elif surface == "metal":
        d = 0.35; n = int(d * SR)
        s = sum(sine(f * p, d) * env(n, 0.0005, 0.08 + 0.03 * k) * a for k, (f, a) in enumerate([(430, 0.4), (870, 0.3), (1390, 0.25), (2210, 0.15)]))
        s += bp(noise(r, n), 800, 6000) * env(n, 0.0005, 0.01) * 0.7
    else:  # wet
        d = 0.3; n = int(d * SR)
        s = lp(noise(r, n), 900) * env(n, 0.003, 0.05) * 0.9
        sq = sweep(260 * p, 90, 0.12) * env(int(0.12 * SR), 0.002, 0.04)
        s[:len(sq)] += sq * 0.6
        s += bp(noise(r, n), 2000, 6000) * env(n, 0.001, 0.006) * 0.3 * (np.arange(n) < int(0.03 * SR))
    return s


def gun_pistol():
    d = 0.5; n = int(d * SR); r = rng("pistol")
    s = lp(noise(r, n), 6000) * env(n, 0.0005, 0.04) + sweep(240, 60, d, 0.4) * env(n, 0.0005, 0.09) * 1.2
    s += bp(noise(r, n), 2000, 9000) * env(n, 0.0002, 0.006) * 0.8
    return reverb(softclip(s, 2), 0.3, 0.2)


def gun_gatling():
    d = 0.22; n = int(d * SR); r = rng("gatling")
    s = lp(noise(r, n), 5000) * env(n, 0.0004, 0.03) + sweep(180, 70, d, 0.5) * env(n, 0.0005, 0.05) * 1.0
    s += bp(noise(r, n), 1500, 8000) * env(n, 0.0002, 0.005)
    return softclip(s, 2)


def gun_yarn():
    d = 0.5; n = int(d * SR); r = rng("yarn")
    s = sweep(120, 380, 0.25, 0.7) * env(int(0.25 * SR), 0.01, 0.12)
    s = np.pad(s, (0, n - len(s)))
    s += bp(noise(r, n), 300, 2500) * env(n, 0.005, 0.07) * 0.8
    s += sweep(500, 120, d, 0.3) * env(n, 0.002, 0.07) * 0.5
    return s


def gun_laser(d=0.9):
    n = int(d * SR)
    t = t_(d)
    f = 880 + 30 * np.sin(2 * np.pi * 7 * t)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.5 + np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR) * 0.25
    s *= 0.7 + 0.3 * np.sin(2 * np.pi * 40 * t)
    return s * np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.05)


def explosion():
    d = 1.6; n = int(d * SR); r = rng("explosion")
    s = lp(noise(r, n), 1500) * env(n, 0.002, 0.35) + sweep(110, 30, d, 0.3) * env(n, 0.002, 0.4) * 1.5
    s += bp(noise(r, n), 800, 7000) * env(n, 0.0005, 0.03)
    return reverb(softclip(s, 2), 0.7, 0.3)


def claw_swipe():
    d = 0.3; n = int(d * SR); r = rng("swipe")
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 2
    return bp(noise(r, n), 1200, 7000) * e


def click(f=1800, d=0.04, k=1):
    n = int(d * SR)
    return sine(f, d) * env(n, 0.0005, 0.008) * k


def reload_sound(kind):
    r = rng("reload_" + kind)
    tl = {"pistol": [(0.0, "slide"), (0.28, "clack"), (0.5, "clack")],
          "gatling": [(0.0, "clack"), (0.3, "slide"), (0.7, "clack"), (0.9, "clack")],
          "yarn": [(0.0, "slide"), (0.35, "thud"), (0.6, "clack")],
          "laser": [(0.0, "whine"), (0.45, "clack")]}[kind]
    out = np.zeros(int(1.3 * SR))
    for at, k in tl:
        if k == "clack":
            n = int(0.09 * SR); s = bp(noise(r, n), 1500, 6000) * env(n, 0.0003, 0.01) + sine(900, 0.09) * env(n, 0.0003, 0.015) * 0.5
        elif k == "slide":
            n = int(0.2 * SR); s = bp(noise(r, n), 600, 4000) * np.sin(np.pi * np.linspace(0, 1, n)) * 0.5
        elif k == "thud":
            n = int(0.15 * SR); s = sweep(160, 60, 0.15) * env(n, 0.001, 0.05)
        else:
            n = int(0.4 * SR); s = sweep(300, 1400, 0.4, 2) * np.sin(np.pi * np.linspace(0, 1, n)) * 0.4
        add(out, s, at)
    return out


def flesh():
    d = 0.2; n = int(d * SR); r = rng("flesh")
    return lp(noise(r, n), 1200) * env(n, 0.001, 0.04) + sweep(200, 70, d) * env(n, 0.001, 0.05)


def headshot():
    d = 0.3; n = int(d * SR)
    return mix(flesh() * 0.8, sine(1500, d) * env(n, 0.0005, 0.03) * 0.5, sine(2250, d) * env(n, 0.0005, 0.02) * 0.3)


def ricochet(v):
    d = 0.5; n = int(d * SR); r = rng(f"rico{v}")
    s = bp(noise(r, n), 1500, 8000) * env(n, 0.0005, 0.01) * 0.6
    s += sweep(2800 + 400 * v, 900 - 100 * v, d, 0.5) * env(n, 0.001, 0.12) * 0.6
    return s


def impact(kind):
    d = 0.25; n = int(d * SR); r = rng("imp" + kind)
    if kind == "stone":
        return bp(noise(r, n), 400, 5000) * env(n, 0.0005, 0.03) + sine(140, d) * env(n, 0.0005, 0.04)
    return bp(noise(r, n), 800, 6000) * env(n, 0.0003, 0.012) + sine(780, d) * env(n, 0.0003, 0.05) * 0.5 + sine(1620, d) * env(n, 0.0003, 0.03) * 0.3


KINDS = {"mouse": 1500, "trooper": 1100, "officer": 850, "sewer": 650, "panzer": 330, "boss": 200}


VOICES = {  # f0 Hz, formants (centre, bandwidth, gain), growl rattle Hz, drive, squeak Hz, syllable seconds
    "mouse": dict(f0=300, form=[(650, 200, 1), (1900, 350, .8), (3300, 500, .5)], growl=60, drive=2.2, sq=3400, dur=.30),
    "trooper": dict(f0=230, form=[(550, 180, 1), (1500, 300, .8), (2800, 450, .4)], growl=52, drive=2.4, sq=3000, dur=.34),
    "officer": dict(f0=180, form=[(500, 160, 1), (1300, 260, .7), (2500, 400, .4)], growl=46, drive=2.6, sq=2800, dur=.36),
    "sewer": dict(f0=150, form=[(420, 150, 1), (1100, 250, .8), (2300, 400, .4)], growl=40, drive=2.4, sq=2600, dur=.40),
    "panzer": dict(f0=90, form=[(330, 120, 1), (850, 200, .7), (1900, 350, .3)], growl=30, drive=2.8, sq=2300, dur=.60),
    "boss": dict(f0=58, form=[(250, 100, 1), (700, 180, .8), (1500, 300, .3)], growl=22, drive=3.0, sq=3800, dur=.80),
}


def formant(x, form):
    X = np.fft.rfft(x); fr = np.fft.rfftfreq(len(x), 1 / SR)
    H = 0.04 + sum(g * np.exp(-0.5 * ((fr - fc) / bw) ** 2) for fc, bw, g in form)
    return np.fft.irfft(X * H, len(x))


def voiced(f, form, growl, drive, r, gdepth=0.45, nh=70):
    """Growly glottal voice: saw source with jitter, formant filter, rattle AM, soft distortion."""
    n = len(f); t = np.arange(n) / SR
    jit = lp(noise(r, n), 60); jit = jit / max(np.abs(jit).max(), 1e-9)
    f = f * (1 + 0.02 * jit)
    y = formant(saw_h(f, n, nh, 6000) + 0.04 * noise(r, n), form)
    y = y * ((1 - gdepth) + gdepth * (0.5 + 0.5 * np.sin(2 * np.pi * growl * t)))
    return waveshape(y, drive)


def hiss(r, d, level, lo=3500, hi=9500, dec=0.035):
    n = int(d * SR)
    return bp(noise(r, n), lo, hi) * env(n, 0.001, dec) * level


def squeak_tone(f0, f1, d, level, vib=0.0):
    n = int(d * SR); t = np.arange(n) / SR; u = np.linspace(0, 1, n)
    f = (f0 + (f1 - f0) * u) * (1 + vib * np.sin(2 * np.pi * 11 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) + 0.25 * np.sin(2 * ph)) * np.sin(np.pi * u) ** 0.6 * level


def _att(n, ms=2.5):
    return np.minimum(1, np.arange(n) / SR / (ms / 1000))


def rat_voice(kind, action):
    """Aggressive-but-cute rodent voice. action: bark|hurt|death|taunt."""
    P = VOICES[kind]; r = rng(f"v2{kind}{action}"); big = kind in ("panzer", "boss")
    f0, form, gr, dr, sq = P["f0"], P["form"], P["growl"], P["drive"], P["sq"]
    if action == "bark":
        nsyl = {"officer": 3, "panzer": 1, "boss": 1}.get(kind, 2)
        sl = P["dur"] if nsyl == 1 else P["dur"] * 0.55
        total = nsyl * (sl + 0.045) + 0.3
        out = np.zeros(int(total * SR))
        for i in range(nsyl):
            n = int(sl * SR); u = np.linspace(0, 1, n)
            rise = (1.0, 1.12, 1.3)[i] if kind == "officer" else 1.0
            f = f0 * rise * (1.4 - 0.55 * u ** 0.6)
            y = voiced(f, form, gr, dr, r) * _att(n) * np.exp(-u * (2.0 if nsyl == 1 else 2.8))
            if big:
                y = y * 0.8
                y += 0.7 * waveshape(sine(f0 * 0.5, sl) * (0.6 + 0.4 * np.sin(2 * np.pi * 18 * np.arange(n) / SR)), 2.0) * _att(n, 6) * np.exp(-u * 1.5)
            add(out, y, i * (sl + 0.045), 1.0)
            add(out, hiss(r, 0.06, 0.28), i * (sl + 0.045), 1.0)
            if i == nsyl - 1 and not big:
                add(out, squeak_tone(sq * 0.95, sq * 1.25, 0.07, 0.13), i * (sl + 0.045) + sl * 0.55)
        if kind == "boss":  # ridiculous bass rumble ending in a squeak
            add(out, squeak_tone(sq, sq * 1.4, 0.16, 0.38, 0.03), 0.78)
        elif kind == "panzer":
            add(out, squeak_tone(sq, sq * 1.3, 0.1, 0.22), 0.52)
        return lp(out, 7500)
    if action == "hurt":
        d = P["dur"] * (1.0 if not big else 0.8); n = int(d * SR); u = np.linspace(0, 1, n); t = u * d
        f = f0 * (1.75 - 0.75 * u) * (1 + 0.07 * np.sin(2 * np.pi * 13 * t))  # playful wobble
        y = voiced(f, form, gr, dr * 0.85, r, 0.35) * _att(n, 2) * np.exp(-u * 2.3)
        out = np.zeros(n + int(0.15 * SR)); out[:n] += y
        add(out, hiss(r, 0.05, 0.22), 0.0)
        add(out, squeak_tone(sq * 1.1, sq * 0.8, d * 0.7, 0.26 if not big else 0.3, 0.05), 0.03)
        return lp(out, 7500)
    if action == "death":
        d = P["dur"] * (2.2 if not big else 1.7); n = int(d * SR); u = np.linspace(0, 1, n); t = u * d
        wob = (0.05 + 0.16 * u) * np.sin(2 * np.pi * (8 + 6 * u) * t)
        f = f0 * (1.5 - 1.1 * u ** 0.7) * (1 + wob)
        y = voiced(f, form, gr, dr * 0.8, r, 0.4) * _att(n, 2) * (1 - u) ** 1.4
        if big:
            y += 0.6 * waveshape(sine(f0 * 0.5, d) * (0.6 + 0.4 * np.sin(2 * np.pi * 12 * t)), 2.0) * _att(n, 8) * (1 - u) ** 1.2
        out = np.zeros(n + int(0.3 * SR)); out[:n] += y
        add(out, hiss(r, 0.05, 0.2), 0.0)
        add(out, squeak_tone(sq * 0.7, sq * 1.2, 0.09 if not big else 0.16, 0.28 if not big else 0.4), d * 0.82)  # deflating "pip"
        return lp(out, 7500)
    # taunt: gravelly chuckle "heh heh heh" with a squeak at the end
    nb = 3 if kind == "boss" else 4; bl = 0.09 if not big else 0.18
    out = np.zeros(int((nb * (bl + 0.05) + 0.4) * SR))
    for i in range(nb):
        n = int(bl * SR); u = np.linspace(0, 1, n)
        f = f0 * (1.15 if i % 2 == 0 else 0.95) * (1.2 - 0.3 * u)
        y = voiced(f, form, gr * 1.5, dr, r, 0.5) * _att(n, 2) * np.exp(-u * 3)
        add(out, y, i * (bl + 0.05), 0.9)
        add(out, hiss(r, 0.04, 0.18), i * (bl + 0.05) + bl * 0.6)
    add(out, squeak_tone(sq * 0.9, sq * 1.3, 0.11, 0.2 if not big else 0.35), nb * (bl + 0.05))
    return lp(out, 7500)


def meow(f0, dur, seed, growl=0.0, drive=1.6, wob=0.0):
    r = rng("meow" + seed); n = int(dur * SR); u = np.linspace(0, 1, n); t = u * dur
    f = f0 * (0.85 + 0.5 * np.sin(np.pi * u) ** 0.8 - 0.18 * u) * (1 + wob * np.sin(2 * np.pi * 7 * t))
    src = saw_h(f, n, 50, 6000) + 0.05 * noise(r, n)
    A = formant(src, [(400, 90, 1), (2300, 260, .6)])
    B = formant(src, [(750, 140, 1), (1250, 200, .8), (2600, 300, .4)])
    C = formant(src, [(500, 110, 1), (900, 150, .7), (2200, 250, .2)])
    wA = np.clip(1 - u * 3.5, 0, 1); wC = np.clip((u - 0.45) * 2.2, 0, 1); wB = np.clip(1 - wA - wC, 0, 1)
    y = A / max(np.abs(A).max(), 1e-9) * wA + B / max(np.abs(B).max(), 1e-9) * wB + C / max(np.abs(C).max(), 1e-9) * wC
    if growl:
        y = y * ((1 - 0.5) + 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * growl * t)))
    e = np.minimum(1, t / 0.012) * np.minimum(1, (dur - t) / 0.05) * (0.75 + 0.25 * np.sin(np.pi * u))
    return waveshape(y, drive) * e


def cat_growl():
    r = rng("catgrowl"); d = 0.6; n = int(d * SR); u = np.linspace(0, 1, n)
    f = 105 * (1 - 0.15 * u) * (1 + 0.03 * np.sin(2 * np.pi * 5 * u * d))
    y = voiced(f, [(450, 130, 1), (1000, 200, .6), (2200, 400, .3)], 36, 2.4, r, 0.55)
    return mix(y * _att(n, 15) * np.sin(np.pi * u) ** 0.5, hiss(r, 0.1, 0.1, 2500, 7000, 0.06))


def purr(d=0.5, level=1.0):
    r = rng(f"purr{d}"); n = int(d * SR); t = np.arange(n) / SR
    am = (0.5 + 0.5 * np.sin(2 * np.pi * 25 * t)) ** 1.5
    y = (lp(noise(r, n), 500) * 1.5 + 0.5 * np.sin(2 * np.pi * 50 * t) + 0.3 * np.sin(2 * np.pi * 100 * t)) * am
    return y * np.sin(np.pi * t / d) ** 0.7 * 0.5 * level


def door(kind):
    r = rng("door" + kind)
    if kind == "open":
        d = 1.0; n = int(d * SR)
        s = bp(noise(r, n), 80, 700) * np.sin(np.pi * np.linspace(0, 1, n)) * 0.7 + sweep(70, 45, d) * np.sin(np.pi * np.linspace(0, 1, n)) * 0.5
        add(s, sweep(300, 120, 0.15) * env(int(0.15 * SR), 0.001, 0.05), 0.0)
        add(s, impact("metal")[:int(0.2 * SR)] * 0.6, 0.85)
        return s
    if kind == "close":
        d = 0.8; n = int(d * SR)
        s = bp(noise(r, n), 80, 700) * np.sin(np.pi * np.linspace(0, 1, n)) ** 2 * 0.5
        add(s, sweep(130, 40, 0.3) * env(int(0.3 * SR), 0.001, 0.1) * 1.4, 0.5)
        add(s, impact("metal")[:int(0.2 * SR)], 0.5)
        return s
    d = 0.5; s = np.zeros(int(d * SR))  # locked
    for a in (0.0, 0.13, 0.26):
        add(s, impact("metal")[:int(0.1 * SR)] * 0.7 + sine(220, 0.1) * env(int(0.1 * SR), 0.001, 0.02) * 0.4, a)
    return s


def arp(notes, step, wave="sine", dec=0.15):
    d = step * len(notes) + dec * 3; out = np.zeros(int(d * SR))
    for i, f in enumerate(notes):
        n = int(dec * 4 * SR); s = sine(f, dec * 4) + 0.3 * sine(f * 2, dec * 4)
        add(out, s * env(n, 0.002, dec), i * step)
    return out


def pickup(kind):
    r = rng("pk" + kind)
    if kind == "health":
        return mix(arp([523, 659, 784], 0.07), purr(0.45, 0.7))
    if kind == "catnip":
        return mix(arp([392, 523, 659, 784, 1047], 0.06) * 0.8, purr(0.5, 0.7))
    if kind == "ammo":
        n = int(0.25 * SR); out = np.zeros(n)
        for a in (0, 0.07, 0.13):
            add(out, bp(noise(r, int(0.06 * SR)), 1500, 6000) * env(int(0.06 * SR), 0.0003, 0.012) + sine(1100, 0.06) * env(int(0.06 * SR), 0.0003, 0.01) * 0.4, a)
        return out
    if kind == "weapon":
        return arp([196, 262, 330], 0.08, dec=0.2)
    if kind == "key":
        return arp([1318, 1760], 0.1, dec=0.35)
    if kind == "treasure":
        return mix(arp([784, 988, 1175, 1568], 0.06, dec=0.25), purr(0.4, 0.5))
    return mix(arp([523, 659, 784, 1047, 1319, 1568], 0.09, dec=0.3), purr(0.6, 0.6))  # extra_life


def player_hurt():
    d = 0.4; y = meow(620, d, "hurt", growl=30, drive=2.0, wob=0.04)
    return mix(y, cat_growl()[:int(0.3 * SR)] * 0.5)


def player_die():
    s = meow(480, 1.0, "die", growl=0, drive=1.5, wob=0.08)
    s = np.pad(s, (0, int(0.4 * SR)))
    add(s, flesh(), 0.9, 0.8)
    return s


def jump():
    d = 0.2; n = int(d * SR); return bp(noise(rng("jump"), n), 300, 2500) * np.sin(np.pi * np.linspace(0, 1, n)) * 0.4


def land():
    d = 0.25; n = int(d * SR)
    return lp(noise(rng("land"), n), 700) * env(n, 0.001, 0.05) + sweep(120, 50, d) * env(n, 0.001, 0.06)


def exit_switch():
    d = 0.9; s = np.zeros(int(d * SR))
    add(s, impact("metal")[:int(0.2 * SR)], 0)
    add(s, arp([392, 523, 784], 0.12, dec=0.3), 0.2, 0.6)
    return s


def pushwall():
    d = 1.5; n = int(d * SR); r = rng("push")
    return lp(noise(r, n), 400) * np.sin(np.pi * np.linspace(0, 1, n)) * 0.9 + sweep(60, 40, d) * np.sin(np.pi * np.linspace(0, 1, n))


def secret():
    return arp([659, 784, 988, 1319], 0.1, dec=0.3)


def ui_click():
    return mix(click(1400, 0.06), click(2100, 0.06, 0.5))


def ui_hover():
    return click(1800, 0.05, 0.5)


# ---------------------------------------------------------------- loops
def loop_len(d):
    return int(d * SR)


def amb_loop(mood):
    D = 12.0; n = loop_len(D); r = rng("amb" + mood); t = np.arange(n) / SR
    base = noise(r, n)
    if mood == "cellar":
        bed = lp(base, 220) * 0.7 + lp(noise(r, n), 90) * 0.8
        bed *= 1 + 0.2 * np.sin(2 * np.pi * t / D)
        for k in range(7):
            at = r.uniform(0, D)
            d = 0.35; m = int(d * SR)
            drip = sine(r.uniform(900, 1500), d) * env(m, 0.001, 0.035) + sweep(1800, 1000, d) * env(m, 0.001, 0.02) * 0.3
            add(bed, drip * 0.35, at, wrap=True)
            add(bed, reverb(drip, 0.4, 0.5, k)[:int(0.6 * SR)] * 0.15, at, wrap=True)
    elif mood == "sewer":
        bed = bp(base, 150, 900) * 0.5 * (1 + 0.5 * np.sin(2 * np.pi * 3 * t / D)) + lp(noise(r, n), 120) * 0.8
        bed += bp(noise(r, n), 2000, 5000) * 0.05 * (0.5 + 0.5 * np.sin(2 * np.pi * 5 * t / D + 1)) ** 2
        for k in range(10):
            at = r.uniform(0, D); d = 0.25; m = int(d * SR)
            blip = sweep(r.uniform(250, 500), r.uniform(600, 1100), d) * env(m, 0.002, 0.05)
            add(bed, blip * 0.25, at, wrap=True)
    else:  # hall
        bed = lp(base, 160) * 0.8 + lp(noise(r, n), 60) * 0.9
        for f, a in ((55, 0.5), (82.5, 0.3), (110, 0.2)):
            bed += np.sin(2 * np.pi * round(f * D) / D * t) * a * 0.5 * (1 + 0.3 * np.sin(2 * np.pi * 2 * t / D))
        for k in range(3):
            at = r.uniform(0, D); d = 1.2; m = int(d * SR)
            add(bed, bp(noise(r, m), 100, 500) * np.sin(np.pi * np.linspace(0, 1, m)) * 0.3, at, wrap=True)
    return bed


MIDI = lambda m: 440.0 * 2 ** ((m - 69) / 12)


def saw_h(f, n, nh_max=40, lim=7000.0):
    """Band-limited saw by harmonic sum. f: scalar Hz or per-sample array."""
    fa = np.full(n, float(f)) if np.isscalar(f) else np.asarray(f, float)
    ph = 2 * np.pi * np.cumsum(fa) / SR
    nh = int(max(1, min(nh_max, lim / max(float(np.max(fa)), 1.0))))
    s = np.zeros(n)
    for k in range(1, nh + 1):
        s += np.sin(k * ph) / k
    return s * (2 / np.pi)


def acid_note(f, d, fc0=2600.0, res=3.0, dec=0.12):
    n = int(d * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * f * t
    fc = 280.0 + fc0 * np.exp(-t / dec)
    s = np.zeros(n)
    for k in range(1, int(min(40, 6000 / f)) + 1):
        kf = k * f
        a = (1.0 / k) / (1 + (kf / fc) ** 4) * (1 + res * np.exp(-((kf - fc) / (fc * 0.18)) ** 2))
        s += a * np.sin(k * ph)
    return s * np.minimum(1, t / 0.002) * np.minimum(1, (d - t) / 0.01)


def waveshape(x, drive):
    x = x / max(np.abs(x).max(), 1e-9)
    return np.tanh(x * drive) / np.tanh(drive)


# per-song spec: bpm, root midi (bass), bars (8): semitone offset per bar, riff patterns, accent offsets, flags
SONGS = {
    "cellar": dict(bpm=128, root=28, prog=[0, 0, 1, 0, 0, 0, 3, 1], minor=True, acid=False, clang=False, lead_oct=36, seed="c",
                   riffs=["XxxxXxxxXxxXxxx-", "XxxXxxXxxXxxXxxx", "XxxxXxxxXxxxXxXx"], acc=[0, 0, 1, 0, 3, 0]),
    "sewer": dict(bpm=140, root=26, prog=[0, 0, 1, 0, 0, 3, 1, 0], minor=True, acid=True, clang=True, lead_oct=36, seed="s",
                  riffs=["XxxXxxXxxXxxXxxx", "XxxxXxxXxxxXxxXx", "XxxXxxXxXxxXxxXx"], acc=[0, 1, 0, 0, 5, 0]),
    "hall": dict(bpm=150, root=33, prog=[0, 0, 8, 10, 0, 0, 8, 7], minor=True, acid=False, clang=True, lead_oct=36, seed="h",
                 riffs=["XxxxXxxxXxxXxxXx", "XxxXxxXxXxxXxxxx", "XxXxXxXxXxxxXxXx"], acc=[0, 0, 0, 3, 0, 7]),
    "boss": dict(bpm=160, root=29, prog=[0, 1, 0, 1, 0, 3, 1, 0], minor=True, acid=True, clang=True, lead_oct=36, seed="b",
                 riffs=["XxxXxxXxxXxxXxXx", "XxXxXxxXxXxXxxXx", "XxxxXxxXxxxXxXXx"], acc=[0, 1, 0, 1, 3, 1]),
    "title": dict(bpm=138, root=31, prog=[0, 0, 8, 10, 0, 0, 5, 7], minor=True, acid=False, clang=False, lead_oct=36, seed="t",
                  riffs=["XxxxXxxxXxxXxxx-", "XxxXxxXxxXxxXxxx", "XxxxXxxxXxxxXxXx"], acc=[0, 0, 3, 0, 7, 0]),
    "victory": dict(bpm=146, root=33, prog=[0, 5, 7, 0, 0, 5, 7, 12], minor=False, acid=False, clang=False, lead_oct=36, seed="v",
                    riffs=["XxxXxxXxxXxxXxxx", "XxxxXxxXxxxXxxXx", "XxxXxxXxXxxXxxXx"], acc=[0, 0, 7, 0, 4, 0]),
}


def music_stems(name):
    """Render one 8-bar loop as separate stems (all circular, so loops are seamless)."""
    S = SONGS[name]; bpm = S["bpm"]; beat = 60.0 / bpm; step = beat / 4; bar = beat * 4
    BARS = 8; n = int(round(BARS * bar * SR)); r = rng("mus2" + name); t = np.arange(n) / SR
    third = 3 if S["minor"] else 4
    st = {k: np.zeros(n) for k in ("kick", "snare", "hat", "bass", "guitar", "lead", "pad", "fx", "clang")}
    at = lambda b, s: b * bar + s * step
    # kick (four on the floor) + snare (2 and 4) + hats
    kk = sweep(165, 46, 0.22, 0.35) * env(int(0.22 * SR), 0.0008, 0.07) + 0.5 * bp(noise(r, int(0.22 * SR)), 1500, 5000) * env(int(0.22 * SR), 0.0002, 0.004)
    sn = mix(bp(noise(r, int(0.2 * SR)), 1400, 7500) * env(int(0.2 * SR), 0.0005, 0.07), 0.7 * sweep(260, 170, 0.12) * env(int(0.12 * SR), 0.0005, 0.04))
    hc = bp(noise(r, int(0.05 * SR)), 6500, 14000) * env(int(0.05 * SR), 0.0003, 0.012)
    ho = bp(noise(r, int(0.15 * SR)), 5500, 14000) * env(int(0.15 * SR), 0.0004, 0.05)
    for b in range(BARS):
        for q in range(4):
            add(st["kick"], kk, at(b, q * 4), 1.0, wrap=True)
        if name in ("boss", "hall") and b % 2 == 1:
            add(st["kick"], kk, at(b, 14), 0.8, wrap=True)
        for s_ in (4, 12):
            add(st["snare"], sn, at(b, s_), 1.0, wrap=True)
        if b % 4 == 3:
            for s_ in (13, 14, 15):
                add(st["snare"], sn, at(b, s_), 0.5, wrap=True)
        for s_ in (2, 6, 10, 14):
            add(st["hat"], ho, at(b, s_), 0.9, wrap=True)
        if name in ("hall", "boss", "title", "victory"):
            for s_ in range(0, 16, 2):
                add(st["hat"], hc, at(b, s_), 0.35, wrap=True)
    # guitar: palm-muted chugs + open accents; power chord = root+5th+octave, double-tracked
    xi = 0
    for b in range(BARS):
        pat = S["riffs"][[0, 0, 0, 1, 0, 0, 1, 2][b]]
        for s_, c in enumerate(pat):
            if c == "-":
                continue
            off = S["prog"][b]
            if c == "X":
                off += S["acc"][xi % len(S["acc"])]; xi += 1
                d = step * 1.6; g = 1.0
            else:
                d = step * 0.62; g = 0.75
            f = MIDI(S["root"] + 12 + off); m = int((d + 0.01) * SR)
            note = np.zeros(m)
            for fx, a in ((f, 1.0), (f * 1.4983, 0.8), (f * 2, 0.7)):
                note += a * (saw_h(fx * 0.997, m, 22, 5000) + saw_h(fx * 1.003, m, 22, 5000)) * 0.5
            tt = np.arange(m) / SR
            note *= np.minimum(1, tt / 0.002) * np.exp(-tt / (d * 0.55 if c == "x" else d * 1.2)) * np.minimum(1, (d + 0.01 - tt) / 0.006)
            add(st["guitar"], note, at(b, s_), g, wrap=True)
    # bass: reese 8ths following the root (acid 16ths for acid songs)
    for b in range(BARS):
        rf = S["root"] + S["prog"][b]
        if S["acid"]:
            line = [0, 0, 12, 0, 0, 7, 0, 12, 0, 0, 12, 0, 3, 0, 7, 0] if b % 2 == 0 else [0, 0, 0, 12, 0, 0, 7, 0, 0, 12, 0, 0, 5, 0, 12, 0]
            for s_, o in enumerate(line):
                if s_ % 2 == 1 and r.random() < 0.35:
                    continue
                add(st["bass"], acid_note(MIDI(rf + 12 + o), step * 0.9), at(b, s_), 0.7, wrap=True)
        else:
            for s_ in range(0, 16, 2):
                o = 12 if (s_ in (6, 14) and b % 2 == 1) else 0
                f = MIDI(rf + o); d = step * 1.8; m = int(d * SR)
                x_ = saw_h(f, m, 30, 3000) + saw_h(f * 1.006, m, 30, 3000) + 0.7 * sine(f / 2, d)
                x_ *= np.minimum(1, np.arange(m) / SR / 0.004) * np.minimum(1, (d - np.arange(m) / SR) / 0.01)
                add(st["bass"], x_, at(b, s_), 0.8, wrap=True)
    # pad: slow chord swell (minor or major triad), window-ed so it is seamless
    for b in range(BARS):
        rf = S["root"] + 24 + S["prog"][b]; m = int(bar * SR)
        x_ = sum(saw_h(MIDI(rf + o) * dt, m, 14, 2500) for o in (0, third, 7) for dt in (0.996, 1.004))
        add(st["pad"], x_ * np.sin(np.pi * np.arange(m) / m) ** 2, b * bar, 1.0, wrap=True)
    # arpeggiated synth lead: 16ths over chord tones; denser and higher in the second half
    tones = [0, third, 7, 12, 7, third] if S["minor"] else [0, 4, 7, 12, 7, 4]
    ai = 0
    for b in range(BARS):
        rf = S["root"] + S["prog"][b] + S["lead_oct"] + (12 if b >= 4 else 0)
        for s_ in range(16):
            if b < 4 and s_ % 2 == 1:
                continue
            f = MIDI(rf + tones[ai % len(tones)]); ai += 1; d = step * 1.5; m = int(d * SR)
            tt = np.arange(m) / SR
            x_ = (saw_h(f, m, 12, 6000) + 0.6 * np.sign(np.sin(2 * np.pi * f * 1.004 * tt))) * np.exp(-tt / 0.07) * np.minimum(1, tt / 0.002)
            add(st["lead"], x_, at(b, s_), 1.0, wrap=True)
    # industrial noise: clangs on off-beats, riser into the loop point, crashes
    if S["clang"]:
        for b in range(BARS):
            for s_ in ((6, 14) if b % 2 == 0 else (10,)):
                m = int(0.5 * SR); tt = np.arange(m) / SR
                x_ = sum(np.sin(2 * np.pi * f_ * tt) * a_ for f_, a_ in ((410, 1), (617, .8), (903, .7), (1247, .5), (1703, .3))) * np.exp(-tt / 0.09)
                x_ += bp(noise(r, m), 900, 6000) * np.exp(-tt / 0.02)
                add(st["clang"], x_, at(b, s_), 0.6, wrap=True)
    rn = int(bar * SR); rr = np.linspace(0, 1, rn) ** 2
    rise = bp(noise(r, rn), 1200, 9000) * rr + 0.35 * sweep(180, 2200, bar, 1.6) * rr
    add(st["fx"], rise, (BARS - 1) * bar, 0.9, wrap=True)
    for b in (0, 4):
        m = int(1.2 * SR)
        add(st["fx"], bp(noise(r, m), 3500, 14000) * env(m, 0.001, 0.3) * 0.6, b * bar, 1.0, wrap=True)
    return st, S, beat, n


def sidechain(n, beat, depth, rel=0.13):
    ph = (np.arange(n) / SR) % beat
    return 1 - depth * np.exp(-ph / rel)


def music_render(name, layer):
    st, S, beat, n = music_stems(name)
    sc = lambda d: sidechain(n, beat, d)
    if layer == "calm":
        kick = lp(st["kick"], 140)  # only beats 1 and 3 of each bar
        bar_n = int(round(beat * 4 * SR)); mask = np.zeros(n)
        for b in range(int(round(n / bar_n))):
            for q in (0, 2):
                i = b * bar_n + int(q * beat * SR); mask[i:i + int(0.3 * SR)] = 1
        kick = kick * mask
        mixd = (0.55 * lp(st["pad"], 1200) * sc(0.5) + 0.9 * lp(st["bass"], 260) * sc(0.5) + 0.7 * kick
                + 0.18 * lp(st["lead"], 1800) * sc(0.3) + 0.12 * st["hat"] + 0.25 * lp(st["clang"], 2500) + 0.2 * lp(st["fx"], 3000))
        mixd = lp(mixd, 3200)
        out = reverb_c(mixd, 0.35)
        return finalize_music(out, -17.0, -3.0)
    g = hp_cab(waveshape(st["guitar"], 9.0))
    bass = waveshape(st["bass"], 2.2)
    mixd = (1.0 * st["kick"] + 0.85 * st["snare"] + 0.30 * st["hat"] + 0.80 * bass * sc(0.7) + 0.85 * g * sc(0.4)
            + 0.30 * lp(st["lead"], 5500) * sc(0.4) + 0.18 * st["pad"] * sc(0.6) + 0.45 * st["clang"] + 0.5 * st["fx"])
    mixd = reverb_c(mixd, 0.12)
    return finalize_music(lp(mixd, 13000), -14.0, -3.0)


def hp_cab(x):
    return fft_filter(x, 90, 4200)


def reverb_c(x, mixamt):
    """Circular (loop-safe) echo/room: a few delayed copies via roll."""
    out = x.copy()
    for dly, g in ((0.043, 0.5), (0.071, 0.4), (0.113, 0.3), (0.17, 0.2)):
        out += np.roll(lp(x, 4000), int(dly * SR)) * g * mixamt * 2
    return out


def finalize_music(x, rms_db, ceil_db):
    x = x - x.mean(); ceil = 10 ** (ceil_db / 20); tgt = 10 ** (rms_db / 20)
    g = tgt / max(np.sqrt(np.mean(x ** 2)), 1e-9)
    for _ in range(8):
        y = ceil * np.tanh(x * g / ceil)
        g *= tgt / max(np.sqrt(np.mean(y ** 2)), 1e-9)
    return ceil * np.tanh(x * g / ceil)


def lufs_approx(f):
    """Rough BS.1770-style loudness: high-pass 38 Hz + 4 dB shelf above 1.5 kHz, mean square."""
    X = np.fft.rfft(f); fr = np.fft.rfftfreq(len(f), 1 / SR)
    H = 1 / (1 + (38 / np.maximum(fr, 1e-3)) ** 4) * (1 + (10 ** (4 / 20) - 1) * (fr / 1500) ** 2 / (1 + (fr / 1500) ** 2))
    y = np.fft.irfft(X * H, len(f))
    return float(-0.691 + 10 * np.log10(max(np.mean(y ** 2), 1e-12)))


# ---------------------------------------------------------------- driver
def save(path, x, peak_db, loop=False, music=False):
    x = np.asarray(x, dtype=np.float64)
    if not loop:
        x = fade(x, 3)
    if not music:
        x = x - x.mean()
        x = x / max(np.abs(x).max(), 1e-9) * 10 ** (peak_db / 20)
    pcm = np.clip(np.round(x * 32767), -32767, 32767).astype("<i2")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    f = pcm / 32767.0
    pk = float(np.abs(f).max()); rms = float(np.sqrt(np.mean(f ** 2)))
    extra = {"lufs_approx": round(lufs_approx(f), 1)} if music else {}
    return {**extra, "peak_db": round(20 * np.log10(pk), 2), "rms_db": round(20 * np.log10(max(rms, 1e-9)), 2), "dur": round(len(f) / SR, 3),
            "loop_edge": round(float(abs(f[0] - f[-1])), 4) if loop else None}


def main():
    man = {}
    def sfx(name, x, pk=-3.0):
        man["sfx/" + name] = save(os.path.join(OUT, "sfx", name + ".wav"), x, pk)
    for s in ("stone", "wood", "metal", "wet"):
        for v in range(1, 5):
            sfx(f"step_{s}_{v}", footstep(s, v), -12)
    sfx("pistol", gun_pistol(), -2); sfx("gatling", gun_gatling(), -4); sfx("yarn", gun_yarn(), -3)
    sfx("laser", gun_laser(), -8); sfx("yarn_launch", gun_yarn(), -3)
    sfx("claws", claw_swipe(), -8); sfx("claw_swipe", claw_swipe(), -8); sfx("claw_hit", mix(flesh(), claw_swipe()[:int(0.2 * SR)] * 0.3), -4)
    sfx("explosion", explosion(), -1); sfx("dry_fire", mix(click(700, 0.08), click(1400, 0.08, 0.3)), -10)
    sfx("weapon_switch", reload_sound("pistol")[:int(0.3 * SR)], -10)
    for k in ("pistol", "gatling", "yarn", "laser"):
        sfx("reload_" + k, reload_sound(k), -8)
    sfx("hit_flesh", flesh(), -5); sfx("headshot", headshot(), -3)
    for v in range(3):
        sfx(f"ricochet_{v+1}", ricochet(v), -8)
    sfx("ricochet", ricochet(1), -8); sfx("impact_stone", impact("stone"), -6); sfx("impact_metal", impact("metal"), -6)
    for k in KINDS:
        for act, pk in (("bark", -5), ("hurt", -5), ("death", -4), ("taunt", -6)):
            sfx(f"{act}_{k}", rat_voice(k, act), pk)
    sfx("cat_growl", cat_growl(), -5)
    sfx("cat_meow_1", meow(420, 0.38, "m1", drive=1.8), -6)
    sfx("cat_meow_2", meow(340, 0.55, "m2", growl=34, drive=2.0), -6)
    sfx("cat_meow_3", meow(520, 0.28, "m3", growl=24, drive=1.6), -6)
    sfx("cat_purr", purr(0.9), -12)
    sfx("door_open", door("open"), -7); sfx("door_close", door("close"), -6); sfx("door_locked", door("locked"), -7)
    for k in ("health", "catnip", "ammo", "weapon", "key", "treasure", "extra_life"):
        sfx("pickup_" + k, pickup(k), -9)
    sfx("extra_life", pickup("extra_life"), -8)
    sfx("player_hurt", player_hurt(), -5); sfx("player_die", player_die(), -4); sfx("jump", jump(), -14); sfx("land", land(), -10)
    sfx("exit_switch", exit_switch(), -6); sfx("pushwall", pushwall(), -7); sfx("secret", secret(), -9); sfx("use_nothing", click(500, 0.1), -14)
    sfx("ui_click", ui_click(), -8); sfx("ui_hover", ui_hover(), -16)
    sfx("level_complete", arp([523, 659, 784, 1047, 784, 1047, 1319], 0.12, dec=0.4), -7)
    for m in ("cellar", "sewer", "hall"):
        man[f"amb/amb_{m}"] = save(os.path.join(OUT, "amb", f"amb_{m}.wav"), amb_loop(m), -9, loop=True)
    for m in ("cellar", "sewer", "hall"):
        for layer, suf in (("calm", ""), ("combat", "_combat")):
            man[f"music/music_{m}{suf}"] = save(os.path.join(OUT, "music", f"music_{m}{suf}.wav"), music_render(m, layer), None, loop=True, music=True)
    for m in ("boss", "title", "victory"):
        man[f"music/music_{m}"] = save(os.path.join(OUT, "music", f"music_{m}.wav"), music_render(m, "combat"), None, loop=True, music=True)
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    print(f"wrote {len(man)} files to {OUT}")


def _png(path, img):
    import struct
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _read(path):
    with wave.open(path) as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767


def sheet(names, outpng, W=360, Hw=48, Hs=64):
    """Waveform (top) + log-ish spectrogram (bottom) per file, stacked into one PNG."""
    rows = []
    for nm in names:
        x = _read(os.path.join(OUT, nm + ".wav"))
        img = np.zeros((Hw + Hs + 2, W, 3), np.uint8)
        cols = np.array_split(np.arange(len(x)), W)
        for i, c in enumerate(cols):
            a = np.abs(x[c]).max(); h = int(a * Hw / 2)
            img[Hw // 2 - h:Hw // 2 + h + 1, i] = (240, 200, 60)
        nf = 512; hop = max(1, (len(x) - nf) // W)
        win = np.hanning(nf)
        for i in range(W):
            seg = x[i * hop:i * hop + nf]
            if len(seg) < nf:
                break
            m = np.abs(np.fft.rfft(seg * win))[:256]
            bins = np.array_split(m, Hs)
            v = np.array([b.mean() for b in bins])
            db = np.clip((20 * np.log10(v + 1e-6) + 70) / 70, 0, 1)
            for y in range(Hs):
                q = db[y]
                img[Hw + 1 + (Hs - 1 - y), i] = (int(255 * min(1, q * 1.6)), int(255 * min(1, max(0, q * 1.6 - .5))), int(120 * q))
        img[Hw] = (60, 60, 60)
        rows.append(img)
    _png(outpng, np.concatenate(rows, 0))


if __name__ == "__main__":
    if "--sheet" in sys.argv:
        pv = "out/previews/audio"
        sheet([f"music/music_{m}{x}" for m in ("cellar", "sewer", "hall") for x in ("", "_combat")] + ["music/music_boss", "music/music_title", "music/music_victory"], pv + "/music.png")
        sheet([f"sfx/{a}_{k}" for k in KINDS for a in ("bark", "hurt", "death", "taunt")][:12], pv + "/voices_a.png", 240, 36, 48)
        sheet([f"sfx/{a}_{k}" for k in KINDS for a in ("bark", "hurt", "death", "taunt")][12:], pv + "/voices_b.png", 240, 36, 48)
        sheet(["sfx/cat_growl", "sfx/cat_meow_1", "sfx/cat_meow_2", "sfx/cat_meow_3", "sfx/player_hurt", "sfx/player_die", "sfx/pickup_health"], pv + "/cat.png", 240, 36, 48)
    else:
        main()
