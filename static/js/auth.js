// Makes the login and sign-up forms work. The form says which one it is: data-auth-form="login"
// or "signup", and that decides which API route it talks to.

(function () {
  const form = document.querySelector("[data-auth-form]");
  if (!form) return;

  const mode = form.dataset.authForm; // "login" or "signup"
  const button = form.querySelector("[data-submit]");
  const errorBox = form.querySelector("[data-error]");

  // the button's look while it's working: the same words Stitch designed
  const idleHtml = button.innerHTML;
  const busyHtml =
    mode === "signup"
      ? '<span class="inline-block animate-spin material-symbols-outlined text-[18px]">progress_activity</span><span>Preparing your calm space...</span>'
      : '<span class="inline-block animate-pulse">Entering sanctuary...</span>';

  function showMessage(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    // restart the soft fade-in each time
    errorBox.classList.remove("fade-in");
    void errorBox.offsetWidth;
    errorBox.classList.add("fade-in");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;

    errorBox.hidden = true;
    const data = Object.fromEntries(new FormData(form));

    button.disabled = true;
    button.innerHTML = busyHtml;

    try {
      await Unpile.api(`/api/${mode}`, { method: "POST", body: data });
      window.location.href = "/"; // the button stays "busy" while the next page loads
    } catch (error) {
      showMessage(error.message);
      button.disabled = false;
      button.innerHTML = idleHtml;
    }
  });

  // show / hide the password (sign up)
  const toggle = document.getElementById("toggle-password");
  const passwordInput = document.getElementById("password");
  const passwordIcon = document.getElementById("password-icon");
  if (toggle && passwordInput && passwordIcon) {
    toggle.addEventListener("click", () => {
      const hidden = passwordInput.getAttribute("type") === "password";
      passwordInput.setAttribute("type", hidden ? "text" : "password");
      passwordIcon.textContent = hidden ? "visibility" : "visibility_off";
    });
  }

  // "Forgot?" on the login screen. We don't have password reset yet, so say so kindly.
  const forgot = document.getElementById("forgot");
  if (forgot) {
    forgot.addEventListener("click", () => showMessage("Password reset is coming soon."));
  }
})();