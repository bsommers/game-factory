---
name: compose-music-sfx
description: Compose chiptune music and sound effects with audio-kit: recipe tables, tracker songs, offline WAV render, jingles and a soundtrack map.
triggers: [music, sfx, sound, audio, song, soundtrack, jingle, wav, chiptune, synth, sound effect, tracker song, drums, loop, webaudio]
needs: [src/kits/audio-kit]
outputs: [sfx recipe table, songs, out/*.wav]
model: sonnet
cost: medium
capabilities: [registry.search]
kits: [audio-kit]
---
# Music and SFX

## Steps
1. SFX: a pure-data recipe table `{ name: (v, {arp}) => { v({src, dur, gain, f}) } }`; preview with `describeSfx` and render offline with `renderSfx`.
2. Songs: `{bpm, bars, loop, channels, drums}`; one bar is exactly 16 sixteenths (`"D5:2 F#5:2 A5:4 .:8"`). Check every bar with `parseBar`.
3. Render with `renderSong(song, sr)` and `toWav(pcm, sr)`; write to `out/`.
4. Map states to tracks with `soundtrack({menu:'title', play:'jungle'})`; stings via `jingle`.
5. Set master gain from measured peaks (peak <= 0.88).

## Gotchas
- Keep recipes pure data; apply pitch scaling after the recipe so live and offline paths agree.
- Loops are seamless when the renderer renders pass k=-1 and wraps.
- Dynamic imports of optional modules need try/catch so Node tests pass.
- WAV duration comes from file size, not a header read.

## Verification
`node --test test/kits/audio-kit*.test.mjs`; durations are right; peaks measured.
