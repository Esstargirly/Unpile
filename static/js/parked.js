(function () {
  const $ = (id) => document.getElementById(id);
  const list = $("parked-shelf-list");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // build with textContent, never innerHTML: these are the person's own words
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(name, className) {
    const node = el("span", `material-symbols-outlined ${className}`, name);
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  function whenLabel(iso) {
    const parkedAt = iso ? new Date(iso) : null;
    if (!parkedAt || Number.isNaN(parkedAt.getTime())) return "Parked";
    const days = Math.round((startOfDay(new Date()) - startOfDay(parkedAt)) / 86400000);
    if (days <= 0) {
      const hour = parkedAt.getHours();
      return `Parked this ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}`;
    }
    if (days === 1) return "Parked yesterday";
    if (days < 7) return `Parked ${days} days ago`;
    return "Parked a while ago";
  }

  function emptyState() {
    const box = el("div", "py-space-xl px-space-md text-center bg-surface-container-lowest rounded-lg shadow-sm");
    box.id = "shelf-empty";
    const sun = icon("wb_sunny", "text-[36px] text-secondary mb-space-sm block");
    box.append(
      sun,
      el("p", "font-headline-md text-headline-md text-primary mb-space-xs", "The shelf is completely empty"),
      el("p", "font-body-md text-body-md text-on-surface-variant", "Your mind is clear and light. Take a deep breath.")
    );
    return box;
  }

  function checkEmpty() {
    if (!list.querySelector("[data-id]") && !$("shelf-empty")) list.appendChild(emptyState());
  }

  function removeCard(card) {
    card.style.opacity = "0";
    card.style.transform = "translateY(-12px) scale(0.98)";
    setTimeout(
      () => {
        card.remove();
        checkEmpty();
      },
      reduced ? 0 : 320
    );
  }

  function buildCard(item) {
    const card = el(
      "div",
      "p-space-lg bg-surface-container-lowest rounded-lg shadow-sm transition-all duration-300 transform rise"
    );
    card.dataset.id = item.id;

    const top = el("div", "flex items-start justify-between gap-space-sm mb-space-sm");
    top.append(
      el(
        "span",
        "inline-flex items-center px-space-sm py-0.5 rounded-full text-label-sm font-label-sm bg-tertiary-fixed text-tertiary",
        whenLabel(item.parked_at)
      ),
      icon("eco", "text-outline-variant text-[18px]")
    );

    const text = el("p", "font-headline-md text-headline-md text-primary mb-space-lg leading-snug break-words", item.title);

    const actions = el("div", "flex items-center gap-space-md pt-space-xs");
    const bring = el(
      "button",
      "flex items-center gap-1 font-label-lg text-label-lg font-semibold text-primary hover:text-primary-container active:scale-95 disabled:opacity-60 transition-all"
    );
    bring.type = "button";
    bring.append(icon("north_east", "text-[18px]"), el("span", "", "Bring back"));
    const letGo = el(
      "button",
      "flex items-center gap-1 font-label-lg text-label-lg text-tertiary hover:text-on-surface active:scale-95 disabled:opacity-60 transition-all"
    );
    letGo.type = "button";
    letGo.append(icon("done_all", "text-[18px]"), el("span", "", "Let go"));
    actions.append(bring, letGo);

    card.append(top, text, actions);

    bring.addEventListener("click", async () => {
      bring.disabled = letGo.disabled = true;
      bring.lastChild.textContent = "Bringing back…";
      try {
        const result = await Unpile.api(`/api/parked/${item.id}/bring-back`, { method: "POST" });
        removeCard(card);
        Unpile.toast(result.active_now ? "That's your focus now." : "Brought back. It's next in line.", "north_east");
        if (result.active_now) setTimeout(() => Unpile.go("/focus"), reduced ? 0 : 1300);
      } catch (error) {
        bring.disabled = letGo.disabled = false;
        bring.lastChild.textContent = "Bring back";
        Unpile.toast(error.message, "info");
      }
    });

    letGo.addEventListener("click", async () => {
      bring.disabled = letGo.disabled = true;
      try {
        await Unpile.api(`/api/parked/${item.id}`, { method: "DELETE" });
        removeCard(card);
        Unpile.toast("Thought gently released into calm.", "filter_vintage");
      } catch (error) {
        bring.disabled = letGo.disabled = false;
        Unpile.toast(error.message, "info");
      }
    });

    return card;
  }

  JSON.parse($("parked-data").textContent).forEach((item) => list.appendChild(buildCard(item)));
  checkEmpty();

  // parking another one from this page: it appears at the top of the shelf
  $("park-another").addEventListener("click", () => UnpilePark.open());
  document.addEventListener("unpile:parked", (event) => {
    const empty = $("shelf-empty");
    if (empty) empty.remove();
    list.prepend(buildCard(event.detail));
  });
})();