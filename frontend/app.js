const API_BASE = "";

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
};

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        provider: state.provider,
        history: state.history.slice(0, -1),
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
