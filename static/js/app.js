// Shared helpers for every Unpile page.

(function () {
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  // Talks to our Flask backend. Always returns the JSON, or throws an ApiError with a message
  // that is safe to show on screen. "body" can be a plain object (sent as JSON) or FormData
  // (used for recordings).
  async function api(url, { method = "GET", body } = {}) {
    const options = { method, credentials: "same-origin", headers: {} };
    if (body instanceof FormData) {
      options.body = body; // the browser sets the right headers itself
    } else if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new ApiError("Couldn't reach Unpile. Check your connection and try again.", 0);
    }

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      // some responses have no body, that's fine
    }

    if (!response.ok) {
      // if the login has expired, go back to the login screen
      if (response.status === 401 && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      throw new ApiError(data.error || "Something went wrong. Please try again.", response.status);
    }
    return data;
  }

  // one place that changes page, so it's easy to test
  function go(url) {
    window.location.href = url;
  }

  // a small, quiet message at the bottom of the screen
  function toast(text, icon = "check_circle") {
    let box = document.getElementById("unpile-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "unpile-toast";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      box.className =
        "fixed bottom-8 left-1/2 -translate-x-1/2 px-5 py-3 rounded-full bg-inverse-surface text-inverse-on-surface " +
        "font-label-md text-label-md shadow-lg pointer-events-none opacity-0 transition-opacity duration-300 " +
        "flex items-center gap-2 z-[70] max-w-[320px] text-center";
      const iconSpan = document.createElement("span");
      iconSpan.className = "material-symbols-outlined text-[18px] text-inverse-primary";
      iconSpan.setAttribute("aria-hidden", "true");
      box.appendChild(iconSpan);
      box.appendChild(document.createElement("span"));
      document.body.appendChild(box);
    }
    box.children[0].textContent = icon;
    box.children[1].textContent = text;
    box.classList.remove("opacity-0");
    clearTimeout(box._timer);
    box._timer = setTimeout(() => box.classList.add("opacity-0"), 2600);
  }

  window.Unpile = { api, ApiError, go, toast };

  // show the icons only once their font has loaded (otherwise you'd see the icon's name as text)
  if (document.fonts && document.fonts.load) {
    document.fonts
      .load('20px "Material Symbols Outlined"')
      .then(() => document.documentElement.classList.add("icons-ready"))
      .catch(() => {});
  }
})();