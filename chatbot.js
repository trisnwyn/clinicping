/* ============================================================
   ClinicPing Chatbot Widget — chatbot.js
   Drop this file (+ chatbot.css) into your HTML page.
   Talks to the local Express backend at /api/chat.
   ============================================================ */

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────
  // Change this if your backend runs on a different port/host.
  const API_URL = "http://localhost:3001/api/chat";

  // Greeting shown when the chat window first opens.
  const GREETING =
    "Xin chào! 👋 Tôi là trợ lý ảo của **ClinicPing**.\n" +
    "Bạn muốn biết gì về hệ thống nhắc lịch hẹn tự động cho phòng khám?\n\n" +
    "Hello! I'm ClinicPing's virtual assistant. Ask me anything about our automated appointment reminder system!";

  // ── Build the HTML shell ──────────────────────────────────
  // We inject everything via JS so you only need one <script> tag.
  function buildUI() {
    // ── Floating trigger button ──
    const trigger = document.createElement("button");
    trigger.id = "cp-trigger";
    trigger.setAttribute("aria-label", "Open chat");
    trigger.innerHTML = `
      <!-- Chat bubble icon -->
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
      </svg>
      <span id="cp-badge"></span>`;

    // ── Chat window ──
    const win = document.createElement("div");
    win.id = "cp-window";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", "ClinicPing chat");
    win.innerHTML = `
      <!-- Header -->
      <div id="cp-header">
        <div id="cp-header-avatar">
          <svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 1 1 0 10A5 5 0 0 1 12 2zm0 12c5.33 0 8 2.67 8 4v2H4v-2c0-1.33 2.67-4 8-4z"/></svg>
        </div>
        <div id="cp-header-info">
          <div id="cp-header-name">ClinicPing Assistant</div>
          <div id="cp-header-status">Online</div>
        </div>
        <button id="cp-close" aria-label="Close chat">
          <svg viewBox="0 0 24 24" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Message list -->
      <div id="cp-messages" role="log" aria-live="polite"></div>

      <!-- Input row -->
      <div id="cp-input-row">
        <textarea
          id="cp-input"
          rows="1"
          placeholder="Nhập câu hỏi… / Ask a question…"
          aria-label="Message input"
        ></textarea>
        <button id="cp-send" aria-label="Send message" disabled>
          <!-- Send (paper-plane) icon -->
          <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </div>`;

    document.body.appendChild(trigger);
    document.body.appendChild(win);
  }

  // ── Conversation history sent to the backend ─────────────
  // Keep the last N turns so the bot has context.
  const MAX_HISTORY = 10;
  let history = [];  // [{role:"user"|"assistant", content:"..."}]

  // ── Helpers ───────────────────────────────────────────────

  /** Auto-grow the textarea as the user types. */
  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 90) + "px";
  }

  /** Scroll the message list to the bottom. */
  function scrollBottom() {
    const msgs = document.getElementById("cp-messages");
    msgs.scrollTop = msgs.scrollHeight;
  }

  /**
   * Append a message bubble to the chat.
   * @param {"bot"|"user"} role
   * @param {string} text  — plain text (newlines respected)
   * @returns {HTMLElement} the bubble element (used to update typing indicator)
   */
  function appendMessage(role, text) {
    const msgs = document.getElementById("cp-messages");

    const wrapper = document.createElement("div");
    wrapper.className = `cp-msg cp-${role}`;

    // Bot gets a small avatar icon; users don't need one.
    if (role === "bot") {
      wrapper.innerHTML = `
        <div class="cp-msg-avatar">
          <svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 1 1 0 10A5 5 0 0 1 12 2zm0 12c5.33 0 8 2.67 8 4v2H4v-2c0-1.33 2.67-4 8-4z"/></svg>
        </div>
        <div class="cp-msg-bubble"></div>`;
    } else {
      wrapper.innerHTML = `<div class="cp-msg-bubble"></div>`;
    }

    // Use textContent (not innerHTML) to prevent XSS from API responses.
    wrapper.querySelector(".cp-msg-bubble").textContent = text;

    msgs.appendChild(wrapper);
    scrollBottom();
    return wrapper.querySelector(".cp-msg-bubble");
  }

  /** Show the animated "typing…" indicator while waiting for the API. */
  function showTyping() {
    const msgs = document.getElementById("cp-messages");

    const wrapper = document.createElement("div");
    wrapper.className = "cp-msg cp-bot cp-typing";
    wrapper.id = "cp-typing-indicator";
    wrapper.innerHTML = `
      <div class="cp-msg-avatar">
        <svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 1 1 0 10A5 5 0 0 1 12 2zm0 12c5.33 0 8 2.67 8 4v2H4v-2c0-1.33 2.67-4 8-4z"/></svg>
      </div>
      <div class="cp-msg-bubble">
        <span class="cp-dot"></span>
        <span class="cp-dot"></span>
        <span class="cp-dot"></span>
      </div>`;

    msgs.appendChild(wrapper);
    scrollBottom();
  }

  /** Remove the typing indicator. */
  function hideTyping() {
    const el = document.getElementById("cp-typing-indicator");
    if (el) el.remove();
  }

  /** Show/hide the unread badge on the trigger button. */
  function setBadge(show) {
    const badge = document.getElementById("cp-badge");
    if (badge) badge.style.display = show ? "flex" : "none";
  }

  // ── API call ──────────────────────────────────────────────
  /**
   * Send the conversation history to the Express backend.
   * The backend holds the Groq API key and forwards the request.
   */
  async function fetchReply(userMessage) {
    // Add user turn to history.
    history.push({ role: "user", content: userMessage });

    // Trim history to avoid sending too many tokens.
    if (history.length > MAX_HISTORY * 2) {
      history = history.slice(-MAX_HISTORY * 2);
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    if (!response.ok) {
      // Surface the HTTP error message if the backend returns one.
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${response.status}`);
    }

    const data = await response.json();
    const reply = data.reply;

    // Add assistant turn to history so future messages have context.
    history.push({ role: "assistant", content: reply });

    return reply;
  }

  // ── Send flow ─────────────────────────────────────────────
  async function sendMessage() {
    const input = document.getElementById("cp-input");
    const sendBtn = document.getElementById("cp-send");
    const text = input.value.trim();

    if (!text) return;

    // Clear input immediately for a snappy feel.
    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;

    // Show the user's message.
    appendMessage("user", text);

    // Show typing indicator while waiting.
    showTyping();

    try {
      const reply = await fetchReply(text);
      hideTyping();
      appendMessage("bot", reply);
    } catch (err) {
      hideTyping();
      appendMessage(
        "bot",
        "Xin lỗi, đã có lỗi xảy ra. Vui lòng thử lại sau.\nSorry, something went wrong. Please try again."
      );
      console.error("[ClinicPing chatbot]", err);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // ── Toggle open/close ─────────────────────────────────────
  let isOpen = false;
  let greeted = false;

  function openChat() {
    const win = document.getElementById("cp-window");
    const trigger = document.getElementById("cp-trigger");

    win.classList.add("cp-open");
    trigger.setAttribute("aria-label", "Close chat");
    isOpen = true;
    setBadge(false);

    // Show greeting only once.
    if (!greeted) {
      greeted = true;
      appendMessage("bot", GREETING);
    }

    // Focus the input after the CSS transition finishes.
    setTimeout(() => document.getElementById("cp-input").focus(), 230);
  }

  function closeChat() {
    const win = document.getElementById("cp-window");
    const trigger = document.getElementById("cp-trigger");

    win.classList.remove("cp-open");
    trigger.setAttribute("aria-label", "Open chat");
    isOpen = false;
  }

  // ── Wire up events ────────────────────────────────────────
  function bindEvents() {
    const trigger = document.getElementById("cp-trigger");
    const closeBtn = document.getElementById("cp-close");
    const input = document.getElementById("cp-input");
    const sendBtn = document.getElementById("cp-send");

    // Toggle on bubble click.
    trigger.addEventListener("click", () => (isOpen ? closeChat() : openChat()));

    // Close button inside the window.
    closeBtn.addEventListener("click", closeChat);

    // Enable/disable send button based on input content.
    input.addEventListener("input", () => {
      autoGrow(input);
      sendBtn.disabled = input.value.trim() === "";
    });

    // Enter sends; Shift+Enter adds a newline.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendMessage();
      }
    });

    sendBtn.addEventListener("click", sendMessage);
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    buildUI();
    bindEvents();
  }

  // Run after the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
