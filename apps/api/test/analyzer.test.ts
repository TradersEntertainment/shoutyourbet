import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SpeechAnalyzer, toMono16k } from "../src/talk/analyzer.js";

/** Decode a fixture to mono 16 kHz PCM with ffmpeg. */
function pcm(name: string, rate = 16000, channels = 1) {
  const file = fileURLToPath(new URL(`./fixtures/${name}.opus`, import.meta.url));
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", String(channels), "-ar", String(rate), "-f", "s16le", "-"], { maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, String(r.stderr));
  return new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 2);
}

function ratio(data: Int16Array, chunk = 960) {
  const an = new SpeechAnalyzer();
  for (let i = 0; i < data.length; i += chunk) an.push(data.subarray(i, i + chunk));
  return { talking: an.talkingSeconds, total: an.windows.length, r: an.talkingSeconds / an.windows.length };
}

test("real speech (EN + TR voiceover) counts as talking", () => {
  const { r, talking, total } = ratio(pcm("speech"));
  assert.ok(r >= 0.75, `speech ${talking}/${total}`);
});

test("quiet mic and noisy room still count", () => {
  for (const f of ["speech_quiet", "speech_noisy"]) {
    const { r, talking, total } = ratio(pcm(f));
    assert.ok(r >= 0.6, `${f} ${talking}/${total}`);
  }
});

test("silence, steady tone, white noise and beeping tone do not count", () => {
  for (const f of ["silence", "tone", "noise", "beeps"]) {
    const { talking, total } = ratio(pcm(f));
    assert.ok(talking <= 1, `${f} ${talking}/${total}`);
  }
});

test("chunk size does not change the result", () => {
  const d = pcm("speech");
  assert.equal(ratio(d, 160).talking, ratio(d, 4800).talking);
});

test("48 kHz stereo input is downmixed/resampled correctly", () => {
  const stereo = pcm("speech", 48000, 2);
  const mono = toMono16k(stereo, 48000, 2);
  const direct = ratio(pcm("speech"));
  const converted = ratio(mono);
  assert.ok(Math.abs(converted.talking - direct.talking) <= 3, `${converted.talking} vs ${direct.talking}`);
});

test("music is a known limitation (documented): flagged here so changes are visible", () => {
  const { r } = ratio(pcm("music"));
  assert.ok(r < 0.75, `music ratio ${r.toFixed(2)} should stay below speech`);
});
