(function () {
  const TARGET_RATE = 24000;
  const FRAME_SAMPLES = 1920; // 80 ms at 24 kHz, the frame size Meta's own example uses
  const MAX_SECONDS = 5 * 60; // 5 minutes is about 14 MB of audio, well under Meta's 32 MB cap

  class RecorderError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code; // "unsupported", "denied" or "unavailable"
    }
  }

  // Converts audio from the microphone's own sample rate (often 44.1 or 48 kHz) to 24 kHz.
  // It remembers where it stopped, so the joins between chunks stay smooth.
  function makeResampler(inRate, outRate) {
    const ratio = inRate / outRate;
    let position = 0; // where the next output sample falls, measured from the start of this chunk
    let previous = 0; // the last sample of the previous chunk

    return function resample(input) {
      const output = [];
      while (true) {
        const index = Math.floor(position);
        if (index + 1 >= input.length) break; // need the sample after this one too
        const a = index < 0 ? previous : input[index];
        const b = input[index + 1];
        output.push(a + (b - a) * (position - index));
        position += ratio;
      }
      position -= input.length;
      previous = input[input.length - 1];
      return output;
    };
  }

  function floatToInt16(value) {
    const clamped = Math.max(-1, Math.min(1, value));
    return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  async function start({ onFrame, onLimit } = {}) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AudioContextClass) {
      throw new RecorderError("unsupported", "This browser can't record audio.");
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
      throw new RecorderError(denied ? "denied" : "unavailable", "Couldn't open the microphone.");
    }

    const context = new AudioContextClass();
    if (context.state === "suspended") await context.resume();

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silent = context.createGain(); // keeps the processor running without playing anything back
    silent.gain.value = 0;
    source.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);

    const resample = makeResampler(context.sampleRate, TARGET_RATE);
    const kept = []; // every piece of 24 kHz audio, for the fallback upload
    let keptSamples = 0;
    let carry = []; // samples waiting to fill the next 80 ms frame
    let stopped = false;

    function emitFrames(final) {
      while (carry.length >= FRAME_SAMPLES || (final && carry.length > 0)) {
        const frame = Int16Array.from(carry.splice(0, FRAME_SAMPLES));
        kept.push(frame);
        keptSamples += frame.length;
        if (onFrame) onFrame(frame);
      }
    }

    processor.onaudioprocess = (event) => {
      if (stopped) return;
      const converted = resample(event.inputBuffer.getChannelData(0));
      for (let i = 0; i < converted.length; i++) carry.push(floatToInt16(converted[i]));
      emitFrames(false);
    };

    const limitTimer = setTimeout(() => {
      if (onLimit) onLimit();
    }, MAX_SECONDS * 1000);

    return {
      async stop() {
        stopped = true;
        clearTimeout(limitTimer);
        processor.disconnect();
        source.disconnect();
        silent.disconnect();
        stream.getTracks().forEach((track) => track.stop()); // turns the mic indicator off
        if (context.close) context.close();
        emitFrames(true); // whatever is left over

        const samples = new Int16Array(keptSamples);
        let offset = 0;
        for (const piece of kept) {
          samples.set(piece, offset);
          offset += piece.length;
        }
        return { samples, seconds: keptSamples / TARGET_RATE };
      },
    };
  }

  // 16-bit mono WAV with a plain 44-byte header
  function toWav(samples, sampleRate = TARGET_RATE) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };

    writeText(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true); // size of this block
    view.setUint16(20, 1, true); // plain PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // bytes per second
    view.setUint16(32, 2, true); // bytes per sample frame
    view.setUint16(34, 16, true); // bits per sample
    writeText(36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);

    return new Blob([buffer], { type: "audio/wav" });
  }

  window.UnpileRecorder = { start, toWav, RecorderError, _makeResampler: makeResampler };
})();