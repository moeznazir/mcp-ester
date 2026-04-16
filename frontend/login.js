const API_BASE = "";
const TOKEN_KEY = "mcp_user_token";

const form = document.getElementById("login-form");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const errEl = document.getElementById("login-error");
const submitBtn = document.getElementById("login-submit");

function hasStoredToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (raw == null) return false;
    return String(raw).trim().length > 0;
  } catch {
    return false;
  }
}

if (hasStoredToken()) {
  window.location.replace("/");
}

function showError(msg) {
  errEl.textContent = msg;
  errEl.hidden = false;
}

function clearError() {
  errEl.textContent = "";
  errEl.hidden = true;
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  clearError();
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  if (!email || !password) {
    showError("Enter email and password.");
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(data.error || `Sign in failed (${res.status})`);
      return;
    }
    const token = data.token;
    if (!token || typeof token !== "string") {
      showError("Server response did not include a token.");
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, token);
    window.location.replace("/");
  } catch (e) {
    showError(
      e instanceof Error ? e.message : "Network error — could not reach the server."
    );
  } finally {
    submitBtn.disabled = false;
  }
});
