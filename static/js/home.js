(function () {
  const $ = (id) => document.getElementById(id);
  const homeView = $("home-view");
  const listeningView = $("listening-view");
  const sortingView = $("sorting-view");
  const mic = $("mic-trigger");
  const caption = $("status-caption");
  const photoButton = $("photo-btn");
  const typeButton = $("type-btn");
  const typePanel = $("type-panel");
  const typeInput = $("type-input");
  const typeSend = $("type-send");
  const typeCancel = $("type-cancel");
  const typeError = typePanel.querySelector("[data-error]");
  const headerBack = $("header-back");

  const listenMic = $("listen-mic");
  const listenDone = $("listen-done");
  const listenCancel = $("listen-cancel");
  const transcriptText = $("transcription-text");
  const liveLabel = $("live-label");

  const IDLE_TEXT = "Tap to speak freely";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the Sorting screen stays up at least this long, so it never just flashes by
  const SORT_MIN_MS = window.UNPILE_SORT_MS !== undefined ? window.UNPILE_SORT_MS : 2200;

  let recorder = null; // the recording in progress, if any
  let live = null; // the live connection, if any
  let busy = false; // true while a dump is being sorted
  let captionTimer = null;
  let sortingTimer = null;

  // ---------- greeting: "Morning, Esther." ----------
  const greeting = $("greeting");
  const hour = new Date().getHours();
  const part = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  greeting.textContent = `${part}, ${greeting.dataset.name}.`;

  // ---------- small helpers ----------
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setCaption(text, { revertAfter = 0 } = {}) {
    clearTimeout(captionTimer);
    caption.textContent = text;
    if (revertAfter) captionTimer = setTimeout(() => (caption.textContent = IDLE_TEXT), revertAfter);
  }

  function setBusy(isBusy) {
    busy = isBusy;
    mic.disabled = isBusy;
    typeSend.disabled = isBusy;
    photoButton.disabled = isBusy;
    typeButton.disabled = isBusy;
  }

  function setListeningControls(enabled) {
    listenDone.disabled = !enabled;
    listenCancel.disabled = !enabled;
    listenMic.disabled = !enabled;
  }

  function showListening() {
    homeView.classList.add("hidden");
    listeningView.classList.remove("hidden");
    listeningView.classList.add("flex", "fade-in");
    // the back arrow in the top bar now means "cancel"
    headerBack.classList.remove("invisible");
    headerBack.removeAttribute("aria-hidden");
    headerBack.removeAttribute("tabindex");
    window.scrollTo(0, 0);
  }

  function showHome(message, revertAfter = 0) {
    listeningView.classList.add("hidden");
    listeningView.classList.remove("flex", "fade-in");
    homeView.classList.remove("hidden");
    headerBack.classList.add("invisible");
    headerBack.setAttribute("aria-hidden", "true");
    headerBack.setAttribute("tabindex", "-1");
    setCaption(message || IDLE_TEXT, { revertAfter });
    setBusy(false);
    setListeningControls(true);
    window.scrollTo(0, 0);
  }

  function showWords(text) {
    transcriptText.textContent = text;
    transcriptText.classList.remove("text-on-surface-variant/60");
    transcriptText.classList.add("text-tertiary");
    transcriptText.scrollTop = transcriptText.scrollHeight; // keep the newest words in view
  }

  function resetListeningScreen() {
    liveLabel.textContent = "";
    transcriptText.textContent = "Start speaking. Your words will show up here.";
    transcriptText.classList.add("text-on-surface-variant/60");
    transcriptText.classList.remove("text-tertiary");
  }

  function recorderMessage(error) {
    if (error.code === "denied") return "Unpile needs your microphone to listen. You can allow it in your browser settings.";
    if (error.code === "unsupported") return "This browser can't record. Try Type it instead.";
    return "Couldn't open the microphone. Try Type it instead.";
  }

  // ---------- the Sorting screen: paper drifts down and settles into a neat stack ----------
  // each frame is one gentle moment in the settling
  const FRAMES = [
    { s3: "translateY(-34px) rotate(4deg)", o3: "0.7", s2: "translateY(-16px) rotate(-2.8deg)", o2: "0.85", s1: "translateY(0px) scale(1)", aura: "scale(0.95)", dot: 0 },
    { s3: "translateY(-18px) rotate(2deg)", o3: "0.85", s2: "translateY(-6px) rotate(-1deg)", o2: "0.95", s1: "translateY(1px) scale(1.01)", aura: "scale(1.05)", dot: 1 },
    { s3: "translateY(-4px) rotate(0.6deg)", o3: "0.95", s2: "translateY(-1px) rotate(-0.3deg)", o2: "1", s1: "translateY(2px) scale(1.015)", aura: "scale(1.08)", dot: 2 },
    { s3: "translateY(-22px) rotate(3deg)", o3: "0.8", s2: "translateY(-10px) rotate(-1.8deg)", o2: "0.9", s1: "translateY(0px) scale(1)", aura: "scale(1)", dot: 1 },
  ];

  function applyFrame(frame) {
    $("sheet-3").style.transform = frame.s3;
    $("sheet-3").style.opacity = frame.o3;
    $("sheet-2").style.transform = frame.s2;
    $("sheet-2").style.opacity = frame.o2;
    $("sheet-1").style.transform = frame.s1;
    $("ambient-glow").style.transform = frame.aura;
    [1, 2, 3].forEach((n, index) => {
      $(`pulse-dot-${n}`).className =
        index === frame.dot
          ? "w-2 h-2 rounded-full bg-primary-container transition-all duration-500"
          : "w-1.5 h-1.5 rounded-full bg-primary-container/25 transition-all duration-500";
    });
  }

  function showSorting() {
    sortingView.classList.remove("hidden");
    sortingView.classList.add("flex", "fade-in");
    document.body.classList.add("overflow-hidden");
    if (reduced) {
      applyFrame(FRAMES[2]); // already neatly stacked, nothing moves
      return;
    }
    let index = 0;
    applyFrame(FRAMES[index]);
    sortingTimer = setInterval(() => {
      index = (index + 1) % FRAMES.length;
      applyFrame(FRAMES[index]);
    }, 1400);
  }

  function hideSorting() {
    clearInterval(sortingTimer);
    sortingView.classList.add("hidden");
    sortingView.classList.remove("flex", "fade-in");
    document.body.classList.remove("overflow-hidden");
  }

  // Shows the Sorting screen while `work` runs (and for at least SORT_MIN_MS), then acts on the answer.
  async function sortWhile(work, onFail) {
    showSorting();
    try {
      const [result] = await Promise.all([work(), wait(SORT_MIN_MS)]);
      if (!result.found) {
        hideSorting();
        onFail(result.message || "I didn't find anything to do in that. Want to try again?");
        return;
      }
      Unpile.go("/focus"); // the Sorting screen stays up while the next page loads
    } catch (error) {
      hideSorting();
      onFail(error.message);
    }
  }

  // ---------- saying it ----------
  async function beginListening() {
    if (busy || recorder) return;

    // audio that's recorded before the live connection is open waits here
    const early = [];
    let connection = null;

    try {
      recorder = await UnpileRecorder.start({
        onFrame: (frame) => (connection ? connection.send(frame) : early.push(frame)),
        onLimit: finishListening,
      });
    } catch (error) {
      setCaption(recorderMessage(error), { revertAfter: 6000 });
      return;
    }

    resetListeningScreen();
    showListening();

    live = connection = UnpileLive.open({
      onReady: () => (liveLabel.textContent = "Real-time"),
      onPartial: showWords,
      onFailed: () => (liveLabel.textContent = "Recording"), // no live words, but we're still recording
    });
    early.forEach((frame) => connection.send(frame));
  }

  async function finishListening() {
    if (!recorder || busy) return;
    const current = recorder;
    const connection = live;
    recorder = null;
    live = null;

    setBusy(true);
    setListeningControls(false);

    let recording;
    try {
      recording = await current.stop();
    } catch (error) {
      if (connection) connection.close();
      showHome(error.message);
      return;
    }
    if (recording.seconds < 0.8) {
      connection.close();
      showHome("That was a little short. Tap and try again.", 3500);
      return;
    }

    await sortWhile(async () => {
      // the words, if live transcription worked
      const spoken = await connection.finish();
      if (spoken && spoken.trim()) {
        return Unpile.api("/api/dump", { method: "POST", body: { text: spoken, source: "voice" } });
      }
      // live transcription wasn't available (or heard nothing): send the whole recording instead
      const form = new FormData();
      form.append("audio", UnpileRecorder.toWav(recording.samples), "dump.wav");
      return Unpile.api("/api/dump", { method: "POST", body: form });
    }, (message) => {
      connection.close();
      showHome(message);
    });
  }

  async function cancelListening() {
    if (busy || !recorder) return;
    const current = recorder;
    const connection = live;
    recorder = null;
    live = null;
    try {
      await current.stop();
    } catch (error) {}
    if (connection) connection.close();
    showHome();
  }

  mic.addEventListener("click", beginListening);
  listenMic.addEventListener("click", finishListening);
  listenDone.addEventListener("click", finishListening);
  listenCancel.addEventListener("click", cancelListening);
  headerBack.addEventListener("click", () => {
    if (recorder) cancelListening();
  });

  // ---------- type it instead ----------
  function showTypeError(message) {
    typeError.textContent = message;
    typeError.hidden = false;
    typeError.classList.remove("fade-in");
    void typeError.offsetWidth;
    typeError.classList.add("fade-in");
  }

  typeButton.addEventListener("click", () => {
    typePanel.classList.remove("hidden");
    typePanel.classList.add("flex", "fade-in");
    typeInput.focus();
    typePanel.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  });

  typeCancel.addEventListener("click", () => {
    typePanel.classList.add("hidden");
    typePanel.classList.remove("flex");
    typeError.hidden = true;
  });

  typeSend.addEventListener("click", async () => {
    const text = typeInput.value.trim();
    if (!text) {
      showTypeError("Write what's on your mind first.");
      return;
    }
    typeError.hidden = true;
    setBusy(true);
    await sortWhile(
      () => Unpile.api("/api/dump", { method: "POST", body: { text } }),
      (message) => {
        showTypeError(message);
        setBusy(false);
      }
    );
  });

  // ---------- photo (coming next) ----------
  photoButton.addEventListener("click", () => {
    setCaption("Photo sorting is coming soon.", { revertAfter: 3500 });
  });

  // if the person leaves the page mid-recording, let go of the microphone
  window.addEventListener("pagehide", () => {
    if (recorder) recorder.stop();
    if (live) live.close();
  });
})();