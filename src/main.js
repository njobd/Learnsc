// src/main.js
// Entry point. Wires all modules together and sets up event listeners.
// Nothing here does work directly — it just orchestrates the other modules.

import { showConnectionStatus, showNotification, startConnectionPolling, stopConnectionPolling } from "./ui.js";
import { checkSupabaseConnection } from "./connection.js";
import { handleLogin, handleLogout } from "./auth.js";
import { loadMessages, sendMessage, subscribeToMessages, unsubscribeFromMessages } from "./chat.js";

// ── App State ──────────────────────────────────────────────

let currentUser = null;

// ── Render helpers ─────────────────────────────────────────

function renderMessages(messages) {
  const container = document.getElementById("messagesContainer");
  if (!container) return;
  container.innerHTML = "";
  messages.forEach(appendMessage);
}

function appendMessage(msg) {
  const container = document.getElementById("messagesContainer");
  if (!container) return;

  const el = document.createElement("div");
  el.className = "message" + (msg.user_id === currentUser?.id ? " message-own" : "");
  el.innerHTML = `
    <span class="message-author">${msg.username ?? "Unknown"}</span>
    <span class="message-content">${msg.content}</span>
    <span class="message-time">${new Date(msg.created_at).toLocaleTimeString()}</span>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ── Auth flow ──────────────────────────────────────────────

async function onLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;

  const user = await handleLogin(username, password);
  if (user) {
    currentUser = user;
    document.getElementById("currentUsername").textContent = user.username;
    await loadMessages(renderMessages);
    subscribeToMessages(appendMessage);
  }
}

async function onLogout() {
  unsubscribeFromMessages();
  stopConnectionPolling();
  await handleLogout();
  currentUser = null;
}

// ── Message send flow ──────────────────────────────────────

async function onSendMessage(e) {
  e.preventDefault();
  if (!currentUser) return;

  const input = document.getElementById("messageInput");
  const content = input.value;
  input.value = "";

  // We need the session token to pass to the Netlify function
  // Adjust this if you're using a custom auth system instead of Supabase Auth
  const { data: { session } } = await import("./bootstrap.js")
    .then(m => m.getSupabase().auth.getSession());

  await sendMessage(content, session?.access_token ?? "");
}

// ── Init ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // Wire up forms
  document.getElementById("loginForm")?.addEventListener("submit", onLoginSubmit);
  document.getElementById("logoutBtn")?.addEventListener("click", onLogout);
  document.getElementById("messageForm")?.addEventListener("submit", onSendMessage);

  // Initial connection check with a short delay to let the module graph settle
  showConnectionStatus("Checking connection...");
  setTimeout(async () => {
    await checkSupabaseConnection();
    startConnectionPolling(checkSupabaseConnection);
  }, 500); // 500ms is sufficient since modules are now properly ordered — no race condition
});

window.addEventListener("beforeunload", () => {
  stopConnectionPolling();
  unsubscribeFromMessages();
});
