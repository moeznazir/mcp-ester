const API_BASE = "";
const TOKEN_KEY = "mcp_user_token";

function getStoredToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (raw == null) return null;
    const t = String(raw).trim();
    return t.length ? t : null;
  } catch {
    return null;
  }
}

/** True only on the main chat shell (index), not on the login page. */
function isChatAppPage() {
  return Boolean(document.getElementById("chat-form"));
}

function authHeaders(base = {}) {
  const t = getStoredToken();
  const headers = { ...base };
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

if (typeof window !== "undefined" && isChatAppPage()) {
  if (!getStoredToken()) {
    window.location.replace("/login");
  }
}

/** When true, server must set DEBUG_BROWSER_MCP_TOKEN=1 — MCP Bearer is echoed for browser console only. */
function mcpBrowserDebugRequested() {
  try {
    if (typeof localStorage === "undefined") return false;
    if (localStorage.getItem("DEBUG_MCP_BROWSER") === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    return new URLSearchParams(window.location.search).get("debugMcp") === "1";
  } catch {
    return false;
  }
}

async function logMcpAuthToBrowserConsole() {
  if (!mcpBrowserDebugRequested()) return;
  try {
    const res = await fetch(`${API_BASE}/api/debug/mcp-auth`, {
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(
        "[MCP DEBUG] /api/debug/mcp-auth failed:",
        data.error || res.status,
        "— set DEBUG_BROWSER_MCP_TOKEN=1 in backend/.env and restart the server."
      );
      return;
    }
    if (data.source) {
      console.warn("[MCP DEBUG] Bearer source:", data.source);
    }
    console.warn(
      "[MCP DEBUG] Authorization Bearer sent to Xano MCP:",
      data.mcpAuthorizationBearer ?? "(null)"
    );
  } catch (e) {
    console.warn("[MCP DEBUG] Could not fetch /api/debug/mcp-auth:", e);
  }
}

if (typeof window !== "undefined") {
  void logMcpAuthToBrowserConsole();
}

const state = {
  provider: "anthropic",
  history: [],
};

const els = {
  panel: document.getElementById("chat-panel"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("message-input"),
  sendBtn: document.getElementById("send-btn"),
  typingRow: document.getElementById("typing-row"),
  typingLabel: document.getElementById("typing-label"),
  activeLabel: document.getElementById("active-label"),
  toggles: document.querySelectorAll(".toggle-btn"),
  logoutBtn: document.getElementById("logout-btn"),
};

if (els.logoutBtn) {
  els.logoutBtn.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  });
}

function providerDisplayName(p) {
  return p === "gemini" ? "Gemini" : "Claude";
}

function setProvider(provider) {
  state.provider = provider === "gemini" ? "gemini" : "anthropic";
  els.activeLabel.textContent = providerDisplayName(state.provider);
  els.toggles.forEach((btn) => {
    const isActive = btn.dataset.provider === state.provider;
    btn.classList.toggle("active", isActive);
  });
}

els.toggles.forEach((btn) => {
  btn.addEventListener("click", () => {
    setProvider(btn.dataset.provider);
    els.input.focus();
  });
});

function scrollToBottom() {
  els.panel.scrollTop = els.panel.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appendBubble({ role, content, providerUsed, isError }) {
  const wrap = document.createElement("div");
  wrap.className = `msg msg--${role}`;
  if (isError) wrap.classList.add("msg--error");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "assistant" && providerUsed) {
    const badge = document.createElement("span");
    badge.className = "provider-badge";
    badge.textContent = providerUsed === "gemini" ? "Gemini" : "Claude";
    bubble.appendChild(badge);
  }

  const text = document.createElement("div");
  text.className = "bubble-text";
  text.innerHTML = escapeHtml(content).replace(/\n/g, "<br />");
  bubble.appendChild(text);

  wrap.appendChild(bubble);
  els.panel.appendChild(wrap);
  scrollToBottom();
}

function setTyping(on, label = "Thinking…") {
  els.typingRow.hidden = !on;
  els.typingLabel.textContent = label;
  if (on) scrollToBottom();
}

async function sendMessage(text) {
  appendBubble({ role: "user", content: text });
  state.history.push({ role: "user", content: text });

  setTyping(true);
  els.sendBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: text,
        provider: state.provider,
        history: state.history.slice(0, -1),
        debugMcp: mcpBrowserDebugRequested(),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = data.error || `Request failed (${res.status})`;
      appendBubble({
        role: "assistant",
        content: errMsg,
        providerUsed: state.provider,
        isError: true,
      });
      return;
    }

    if (data.debug) {
      console.warn(
        "[MCP DEBUG] Echo from /api/chat (server DEBUG_BROWSER_MCP_TOKEN=1 + client debugMcp):"
      );
      if (data.debug.source) {
        console.warn("[MCP DEBUG] Bearer source:", data.debug.source);
      }
      console.warn(
        "[MCP DEBUG] mcpAuthorizationBearer:",
        data.debug.mcpAuthorizationBearer ?? "(null)"
      );
    }

    const reply = data.reply ?? "";
    const used = data.provider || state.provider;
    appendBubble({
      role: "assistant",
      content: reply,
      providerUsed: used,
    });
    state.history.push({ role: "assistant", content: reply });
  } catch (e) {
    const errMsg =
      e instanceof Error ? e.message : "Network error — could not reach the server.";
    appendBubble({
      role: "assistant",
      content: errMsg,
      providerUsed: state.provider,
      isError: true,
    });
  } finally {
    setTyping(false);
    els.sendBtn.disabled = false;
    els.input.focus();
  }
}

els.form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  sendMessage(text);
});

els.input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    els.form.requestSubmit();
  }
});

setProvider(state.provider);
