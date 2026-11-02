(function () {
  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reduced ? Math.min(ms, 30) : ms));

  const focusView = $("focus-view");
  const clearView = $("clear-view");
  const card = $("focus-card");
  const title = $("task-title");
  const step = $("task-step");
  const context = $("task-context");
  const restNote = $("rest-note");
  const intro = $("intro");
  const echoBadge = $("echo-badge");
  const doneButton = $("btn-done");
  const notNowButton = $("btn-not-now");
  const detailButton = $("btn-quick-note");
  const editor = $("step-editor");
  const stepInput = $("step-input");
  const editorError = editor.querySelector("[data-error]");

  let state = JSON.parse($("focus-data").textContent);
  let busy = false;
  let introTimers = [];

  // ---------- "Morning cadence" ----------
  const hour = new Date().getHours();
  $("cadence").textContent = `${hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening"} cadence`;

  // ---------- drawing the task ----------
  function renderContext(task) {
    context.textContent = "";
    context.classList.add("flex-wrap");
    const parts = [];
    if (task.minutes) parts.push(task.minutes === 1 ? "Takes 1 minute" : `Takes ${task.minutes} minutes`);
    if (task.urgency_reason) parts.push(task.urgency_reason);
    parts.forEach((text, index) => {
      if (index) {
        const dot = document.createElement("span");
        dot.className = "text-outline-variant";
        dot.textContent = "•";
        context.appendChild(dot);
      }
      const span = document.createElement("span");
      span.textContent = text;
      context.appendChild(span);
    });
    context.classList.toggle("hidden", parts.length === 0);
  }

  function renderTask(task) {
    title.textContent = task.title;
    step.textContent = task.next_action ? `First step: ${task.next_action}` : "";
    step.classList.toggle("hidden", !task.next_action);
    renderContext(task);
    closeEditor();
  }

  function renderRestNote() {
    restNote.classList.toggle("hidden", !state.has_more);
    restNote.classList.toggle("flex", state.has_more);
  }

  function showClear() {
    $("clear-count").textContent = state.cleared;
    $("clear-unit").textContent = state.cleared === 1 ? "moment" : "moments";
    $("shelf-count").textContent = state.parked;
    $("shelf-unit").textContent = state.parked === 1 ? "thought" : "thoughts";
    focusView.classList.add("hidden");
    clearView.classList.remove("hidden");
    clearView.classList.add("flex", "fade-in");
    window.scrollTo(0, 0);
  }

  // shows whatever the server says is true right now
  function show(next) {
    state = next;
    if (state.active) {
      renderTask(state.active);
      renderRestNote();
    } else if (state.all_clear) {
      showClear();
    } else {
      Unpile.go("/"); // nothing to focus on yet
    }
  }

  // ---------- gentle motion ----------
  function fadeCard(out) {
    card.classList.toggle("opacity-20", out);
    card.classList.toggle("scale-[0.98]", out);
  }

  function setDoneButton(completed) {
    doneButton.textContent = "";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-[22px]";
    icon.setAttribute("aria-hidden", "true");
    icon.style.fontVariationSettings = "'FILL' 1";
    icon.textContent = completed ? "task_alt" : "check";
    const label = document.createElement("span");
    label.textContent = completed ? "Completed" : "Done";
    doneButton.append(icon, label);
  }

  function showIntro(finishedTitle) {
    introTimers.forEach(clearTimeout);
    introTimers = [];
    $("echo-title").textContent = finishedTitle;
    intro.style.opacity = "1";
    echoBadge.style.opacity = "1";
    intro.classList.remove("hidden");
    introTimers.push(setTimeout(() => (echoBadge.style.opacity = "0.35"), reduced ? 0 : 2200));
    introTimers.push(
      setTimeout(
        () => {
          intro.style.opacity = "0";
          introTimers.push(setTimeout(() => intro.classList.add("hidden"), reduced ? 0 : 700));
        },
        reduced ? 0 : 5200
      )
    );
  }

  // ---------- Done ----------
  async function done() {
    if (busy || !state.active) return;
    busy = true;
    const finished = state.active;
    doneButton.disabled = true;
    notNowButton.disabled = true;
    setDoneButton(true);
    fadeCard(true);
    try {
      const [next] = await Promise.all([
        Unpile.api("/api/focus/done", { method: "POST", body: { task_id: finished.id } }),
        wait(320),
      ]);
      show(next);
      if (next.active) showIntro(finished.title);
    } catch (error) {
      Unpile.toast(error.message, "info");
    } finally {
      fadeCard(false);
      setDoneButton(false);
      doneButton.disabled = false;
      notNowButton.disabled = false;
      busy = false;
    }
  }

  // ---------- Not now ----------
  async function notNow() {
    if (busy || !state.active) return;
    busy = true;
    doneButton.disabled = true;
    notNowButton.disabled = true;
    fadeCard(true);
    try {
      const [next] = await Promise.all([
        Unpile.api("/api/focus/not-now", { method: "POST", body: { task_id: state.active.id } }),
        wait(320),
      ]);
      show(next);
      Unpile.toast(next.only_one ? "That's the only thing left right now." : "Deferred for later.", "history");
    } catch (error) {
      Unpile.toast(error.message, "info");
    } finally {
      fadeCard(false);
      doneButton.disabled = false;
      notNowButton.disabled = false;
      busy = false;
    }
  }

  // ---------- Add detail: rewrite the first step ----------
  function openEditor() {
    if (!state.active) return;
    stepInput.value = state.active.next_action || "";
    editorError.hidden = true;
    editor.classList.remove("hidden");
    editor.classList.add("flex");
    step.classList.add("hidden");
    stepInput.focus();
  }

  function closeEditor() {
    editor.classList.add("hidden");
    editor.classList.remove("flex");
    editorError.hidden = true;
    if (state.active && state.active.next_action) step.classList.remove("hidden");
  }

  detailButton.addEventListener("click", () => (editor.classList.contains("hidden") ? openEditor() : closeEditor()));
  $("step-cancel").addEventListener("click", closeEditor);
  stepInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeEditor();
  });

  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = stepInput.value.trim();
    if (!text) {
      editorError.textContent = "Write a first step, or leave it as it is.";
      editorError.hidden = false;
      return;
    }
    try {
      show(await Unpile.api("/api/focus/step", { method: "POST", body: { task_id: state.active.id, next_action: text } }));
      Unpile.toast("Step updated.", "edit_note");
    } catch (error) {
      editorError.textContent = error.message;
      editorError.hidden = false;
    }
  });

  // ---------- park a thought, sound, all-clear ----------
  $("btn-park-thought").addEventListener("click", () => UnpilePark.open());
  document.addEventListener("unpile:parked", () => Unpile.toast("Parked. Back to your one thing.", "inventory_2"));

  const soundButton = $("btn-soundscape");
  soundButton.addEventListener("click", async () => {
    const on = await UnpileAmbient.toggle();
    if (on === null) {
      Unpile.toast("Sound isn't available in this browser.", "volume_off");
      return;
    }
    soundButton.setAttribute("aria-pressed", String(on));
    soundButton.classList.toggle("bg-secondary-container", on);
    soundButton.classList.toggle("text-on-secondary-container", on);
    soundButton.classList.toggle("text-tertiary", !on);
    Unpile.toast(on ? "Soft sound on." : "Sound off.", on ? "air" : "volume_off");
  });

  $("linger").addEventListener("click", () => Unpile.toast("Take a slow breath. Ready when you are.", "spa"));

  doneButton.addEventListener("click", done);
  notNowButton.addEventListener("click", notNow);

  show(state);
})();