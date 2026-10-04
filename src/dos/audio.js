// DOS sound: the emulator pushes blocks of samples (mono, at its own rate,
// `ci.soundFrequency()`, 44100 Hz for js-dos 8) and the page plays them.
//
// The samples are resampled to the AudioContext's own rate (often 48000 Hz;
// played at the wrong rate the sound would be pitched and the queue would
// run dry or pile up) with linear interpolation, and the queue is kept
// short: past `maxSeconds` the oldest blocks are dropped, so the sound never
// lags the picture by more than that.
//
// The page plays through a ScriptProcessorNode. An AudioWorklet would need
// its module loaded from the package, which js-dos does from a blob: address
// the frame's policy refuses; the ScriptProcessor was measured
// working in Chromium, Firefox and WebKit inside filex's frame.

export class Resampler {
  constructor(srcRate, dstRate, maxSeconds = 0.25) {
    this.step = srcRate > 0 && dstRate > 0 ? srcRate / dstRate : 1;
    this.max = Math.max(1, Math.ceil(srcRate * maxSeconds));
    this.chunks = [];
    this.pos = 0;
    this.buffered = 0;
    this.dropped = 0;
    this.played = 0;
  }

  /** Queue a block of samples. */
  push(samples) {
    if (!samples || !samples.length) return;
    this.chunks.push(samples);
    this.buffered += samples.length;
    while (this.chunks.length > 1 && this.buffered - this.pos > this.max) {
      const first = this.chunks.shift();
      this.buffered -= first.length;
      this.dropped += first.length;
      this.pos = Math.max(0, this.pos - first.length);
    }
  }

  at(i) {
    for (const c of this.chunks) {
      if (i < c.length) return c[i];
      i -= c.length;
    }
    return 0;
  }

  /** Fill `out` at the destination rate; answers how many samples were real (the rest is silence). */
  pull(out) {
    let n = 0;
    while (n < out.length) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      if (i >= this.buffered || (f > 0 && i + 1 >= this.buffered)) break;
      const a = this.at(i);
      out[n++] = f === 0 ? a : a + (this.at(i + 1) - a) * f;
      this.pos += this.step;
      while (this.chunks.length && this.pos >= this.chunks[0].length) {
        const first = this.chunks.shift();
        this.pos -= first.length;
        this.buffered -= first.length;
      }
    }
    out.fill(0, n);
    this.played += n;
    return n;
  }
}

/**
 * Play the emulator's sound in `ctx` (an AudioContext, or null: then the
 * emulator is muted). Answers `{node, resampler, setEnabled(on), stop()}`.
 */
export function playSound(ctx, ci) {
  const rate = ci.soundFrequency() || 44100;
  if (!ctx || typeof ctx.createScriptProcessor !== 'function') {
    ci.mute();
    return { node: null, resampler: null, setEnabled() {}, stop() {} };
  }
  const resampler = new Resampler(rate, ctx.sampleRate);
  let enabled = true;
  const node = ctx.createScriptProcessor(2048, 0, 1);
  node.onaudioprocess = (ev) => {
    const out = ev.outputBuffer.getChannelData(0);
    if (enabled) resampler.pull(out);
    else out.fill(0);
  };
  node.connect(ctx.destination);
  ci.events().onSoundPush((samples) => {
    if (enabled) resampler.push(samples);
  });
  return {
    node,
    resampler,
    setEnabled(on) {
      enabled = !!on;
      if (enabled) ci.unmute();
      else {
        ci.mute();
        resampler.chunks = [];
        resampler.buffered = 0;
        resampler.pos = 0;
      }
    },
    stop() {
      try {
        node.disconnect();
      } catch {
        /* already gone */
      }
    },
  };
}
