import { describe, expect, it, vi } from 'vitest';
import { Resampler, playSound } from '../../src/dos/audio.js';

const f32 = (list) => Float32Array.from(list);
const pull = (r, n) => {
  const out = new Float32Array(n);
  const got = r.pull(out);
  return { got, out: Array.from(out) };
};

describe('Resampler', () => {
  it('passes samples through at the same rate, across blocks', () => {
    const r = new Resampler(44100, 44100);
    r.push(f32([0.1, 0.2]));
    r.push(f32([0.3]));
    const { got, out } = pull(r, 3);
    expect(got).toBe(3);
    expect(out.map((v) => +v.toFixed(4))).toEqual([0.1, 0.2, 0.3]);
  });

  it('halves the rate by stepping two samples at a time', () => {
    const r = new Resampler(2, 1);
    r.push(f32([0, 1, 2, 3, 4, 5, 6]));
    expect(pull(r, 3).out).toEqual([0, 2, 4]);
  });

  it('doubles the rate by interpolating between samples', () => {
    const r = new Resampler(1, 2, 10);
    r.push(f32([0, 1]));
    r.push(f32([3]));
    const { got, out } = pull(r, 4);
    expect(got).toBe(4);
    expect(out).toEqual([0, 0.5, 1, 2]);
  });

  it('fills with silence when the emulator is behind, and says how much was real', () => {
    const r = new Resampler(1, 1);
    r.push(f32([0.5, 0.25]));
    const { got, out } = pull(r, 5);
    expect(got).toBe(2);
    expect(out).toEqual([0.5, 0.25, 0, 0, 0]);
    expect(pull(r, 2).got).toBe(0);
    expect(r.played).toBe(2);
  });

  it('keeps the queue short: the oldest blocks go first', () => {
    const r = new Resampler(10, 10, 0.5);
    for (let i = 0; i < 6; i++) r.push(f32([i, i, i]));
    expect(r.buffered).toBeLessThanOrEqual(5 + 3);
    expect(r.dropped).toBeGreaterThan(0);
    expect(pull(r, 1).out[0]).toBeGreaterThanOrEqual(4);
  });

  it('plays 44.1 kHz at 48 kHz without running dry or piling up', () => {
    const r = new Resampler(44100, 48000);
    let real = 0;
    for (let block = 0; block < 100; block++) {
      r.push(new Float32Array(441).fill(0.5));
      if (block % 5 === 4) real += r.pull(new Float32Array(2400));
    }
    expect(real).toBeGreaterThan(2400 * 20 - 100);
    expect(r.buffered - r.pos).toBeLessThan(441 * 2);
  });
});

describe('playSound', () => {
  function fakeCi(rate = 44100) {
    const pushes = [];
    return {
      calls: [],
      soundFrequency: () => rate,
      mute() {
        this.calls.push('mute');
      },
      unmute() {
        this.calls.push('unmute');
      },
      events: () => ({ onSoundPush: (fn) => pushes.push(fn) }),
      push: (s) => pushes.forEach((fn) => fn(s)),
    };
  }

  it('mutes the emulator when there is no sound here', () => {
    const ci = fakeCi();
    const s = playSound(null, ci);
    expect(ci.calls).toEqual(['mute']);
    expect(s.node).toBe(null);
  });

  it('plays the pushed samples through a ScriptProcessor at the context rate', () => {
    const ci = fakeCi(48000);
    const node = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
    const ctx = { sampleRate: 48000, destination: {}, createScriptProcessor: vi.fn(() => node) };
    const s = playSound(ctx, ci);
    expect(ctx.createScriptProcessor).toHaveBeenCalledWith(2048, 0, 1);
    expect(node.connect).toHaveBeenCalledWith(ctx.destination);
    ci.push(f32([0.25, 0.5]));
    const out = new Float32Array(4);
    node.onaudioprocess({ outputBuffer: { getChannelData: () => out } });
    expect(Array.from(out)).toEqual([0.25, 0.5, 0, 0]);
    s.setEnabled(false);
    expect(ci.calls).toContain('mute');
    ci.push(f32([0.75]));
    node.onaudioprocess({ outputBuffer: { getChannelData: () => out } });
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
    s.setEnabled(true);
    expect(ci.calls).toContain('unmute');
    s.stop();
    expect(node.disconnect).toHaveBeenCalled();
  });
});
