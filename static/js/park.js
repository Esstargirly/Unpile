(function () {
  const root = document.getElementById("park-root");
  if (!root) return;

  const $ = (id) => document.getElementById(id);
  const scrim = $("park-scrim");
  const card = $("park-card");
  const input = $("park-input");
  const mic = $("park-mic");
  const micIcon = mic.querySelector(".material-symbols-outlined");
  const submit = $("park-submit");
  const cancel = $("park-cancel");
  const errorBox = root.querySelector("[data-error]");
  const pills = root.querySelectorAll(".park-pill");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SUBMIT_IDLE = submit.innerHTML;
  const PLACEHOLDER = input.getAttribute("placeholder");

  let isOpen = false;
  let submitting = false;
  let recorder = null;
  let live = null;
  let dictationBase = "";
  let opener = null;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.classList.remove("fade-in");
    void errorBox.offsetWidth;
    errorBox.classList.add("fade-in");
  }

  function reset() {
    input.value = "";
    input.setAttribute("placeholder", PLACEHOLDER);
    errorBox.hidden = true;
    submit.innerHTML = SUBMIT_IDLE;
    submit.disabled = false;
    submit.classList.replace("bg-secondary", "bg-primary-container");
    pills.forEach((p) => p.classList.remove("bg-secondary-container", "text-on-secondary-container"));
    setMicStyle(false);
    mic.disabled = false;
  }

  // ---------- open and close ----------
  function open() {
    if (isOpen) return;
    isOpen = true;
    opener = document.activeElement;
    reset();
    root.classList.remove("hidden");
    // start below the screen, then slide up
    card.classList.add("translate-y-full");
    scrim.classList.add("opacity-0");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        card.classList.remove("translate-y-full");
        scrim.classList.remove("opacity-0");
      })
    );
    document.body.classList.add("overflow-hidden");
    setTimeout(() => input.focus(), 350);
  }

  async function close() {
    if (!isOpen || submitting) return;
    isOpen = false;
    await stopDictation({ discard: true });
    card.classList.add("translate-y-full");
    scrim.classList.add("opacity-0");
    setTimeout(
      () => {
        root.classList.add("hidden");
        document.body.classList.remove("overflow-hidden");
        reset();
        if (opener && opener.focus) opener.focus();
      },
      reducedMotion ? 0 : 260
    );
  }

  // ---------- saying the thought ----------
  function setMicStyle(listening) {
    mic.classList.toggle("bg-surface-container/60", !listening);
    mic.classList.toggle("text-primary-container", !listening);
    mic.classList.toggle("bg-tertiary-fixed", listening);
    mic.classList.toggle("text-tertiary", listening);
    mic.classList.toggle("animate-pulse", listening);
    micIcon.textContent = "mic";
  }

  function recorderMessage(error) {
    if (error.code === "denied") return "Unpile needs your microphone to listen. You can allow it in your browser settings.";
    return "Couldn't open the microphone. You can type the thought instead.";
  }

  async function startDictation() {
    errorBox.hidden = true;
    dictationBase = input.value.trim();
    const early = [];
    let connection = null;

    try {
      recorder = await UnpileRecorder.start({
        onFrame: (frame) => (connection ? connection.send(frame) : early.push(frame)),
        onLimit: () => stopDictation(),
      });
    } catch (error) {
      showError(recorderMessage(error));
      return;
    }

    setMicStyle(true);
    input.setAttribute("placeholder", "Listening gently...");
    live = connection = UnpileLive.open({
      onPartial: (text) => {
        input.value = dictationBase ? `${dictationBase} ${text}` : text;
      },
      onFailed: () => {}, // no live words: we'll transcribe the recording when they finish
    });
    early.forEach((frame) => connection.send(frame));
  }

  async function stopDictation({ discard = false } = {}) {
    if (!recorder) return;
    const current = recorder;
    const connection = live;
    recorder = null;
    live = null;
    setMicStyle(false);
    input.setAttribute("placeholder", PLACEHOLDER);

    let result;
    try {
      result = await current.stop();
    } catch (error) {
      if (connection) connection.close();
      return;
    }
    if (discard) {
      if (connection) connection.close();
      return;
    }

    mic.disabled = true;
    try {
      let text = connection ? await connection.finish() : null;
      if (!text && result.seconds >= 0.8) {
        // live words weren't available: transcribe the whole recording instead
        const form = new FormData();
        form.append("audio", UnpileRecorder.toWav(result.samples), "thought.wav");
        text = (await Unpile.api("/api/transcribe", { method: "POST", body: form })).text;
      }
      if (text && text.trim()) {
        input.value = dictationBase ? `${dictationBase} ${text.trim()}` : text.trim();
      } else if (result.seconds >= 0.8) {
        showError("I didn't catch that. Try again, or type it.");
      }
    } catch (error) {
      if (connection) connection.close();
      showError(error.message);
    } finally {
      mic.disabled = false;
    }
  }

  mic.addEventListener("click", () => (recorder ? stopDictation() : startDictation()));

  // ---------- park it ----------
  submit.addEventListener("click", async () => {
    if (submitting) return;
    if (recorder) await stopDictation();

    const text = input.value.trim();
    if (!text) {
      showError("Write or say the thought first.");
      return;
    }

    errorBox.hidden = true;
    submitting = true;
    submit.disabled = true;
    submit.innerHTML = '<span class="material-symbols-outlined text-[20px] animate-spin" aria-hidden="true">sync</span><span>Parking...</span>';

    try {
      const result = await Unpile.api("/api/park", { method: "POST", body: { text } });
      submit.innerHTML = '<span class="material-symbols-outlined text-[20px]" aria-hidden="true">check</span><span>Safely Parked</span>';
      submit.classList.replace("bg-primary-container", "bg-secondary");
      document.dispatchEvent(new CustomEvent("unpile:parked", { detail: result.parked }));
      setTimeout(
        () => {
          submitting = false;
          close();
        },
        reducedMotion ? 0 : 500
      );
    } catch (error) {
      submitting = false;
      submit.disabled = false;
      submit.innerHTML = SUBMIT_IDLE;
      showError(error.message);
    }
  });

  // ---------- the rest ----------
  cancel.addEventListener("click", close);
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  // "Tend to later": pick one (it's a gentle label for now, it doesn't change anything yet)
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("bg-secondary-container", "text-on-secondary-container"));
      pill.classList.add("bg-secondary-container", "text-on-secondary-container");
    });
  });

  window.UnpilePark = { open, close };
})();