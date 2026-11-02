(function () {
  let context = null;
  let master = null;
  let playing = false;
  let stopTimer = null;

  const FADE_IN_SECONDS = 1.6;
  const FADE_OUT_SECONDS = 1.2;
  const VOLUME = 0.1; // quiet on purpose

  function build() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    context = new AudioContextClass();

    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const swell = context.createGain(); // the slow breathing in and out
    swell.gain.value = 0.7;
    swell.connect(master);

    const filter = context.createBiquadFilter(); // softens the notes
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.connect(swell);

    // A2, E3, A3: an open, restful chord, each note a hair out of tune so it shimmers
    [110, 164.81, 220].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = (index - 1) * 4;
      const level = context.createGain();
      level.gain.value = 0.33;
      oscillator.connect(level);
      level.connect(filter);
      oscillator.start();
    });

    const lfo = context.createOscillator(); // one slow wave, about every 14 seconds
    lfo.frequency.value = 0.07;
    const depth = context.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth);
    depth.connect(swell.gain);
    lfo.start();
    return true;
  }

  async function toggle() {
    if (!context && !build()) return null;
    clearTimeout(stopTimer);
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);

    if (playing) {
      master.gain.linearRampToValueAtTime(0, now + FADE_OUT_SECONDS);
      stopTimer = setTimeout(() => context.suspend(), FADE_OUT_SECONDS * 1000 + 100);
      playing = false;
    } else {
      if (context.state === "suspended") await context.resume();
      master.gain.linearRampToValueAtTime(VOLUME, context.currentTime + FADE_IN_SECONDS);
      playing = true;
    }
    return playing;
  }

  window.UnpileAmbient = { toggle };
})();