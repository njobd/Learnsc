// src/chat.js
// Handles all messaging: sending, fetching history, and
// subscribing to Supabase Realtime for live updates.
// The send-message Netlify function is called for writes
// so that the service role key never touches the browser.

import { getSupabase } from "./bootstrap.js";
import { showNotification } from "./ui.js";

let realtimeChannel = null;

// ── Fetch message history ──────────────────────────────────

/**
 * Loads existing messages from Supabase and renders them.
 * @param {Function} renderFn - called with an array of message objects
 */
export async function loadMessages(renderFn) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;
    renderFn(data ?? []);
  } catch (err) {
    console.error("Failed to load messages:", err);
    showNotification("Could not load message history.", true);
  }
}

// ── Send a message ─────────────────────────────────────────

/**
 * Posts a new message through the Netlify serverless function.
 * The function validates the user server-side using the Supabase service role.
 * @param {string} content  - message text
 * @param {string} authToken - the user's Supabase session token
 */
export async function sendMessage(content, authToken) {
  if (!content || !content.trim()) return;

  try {
    const res = await fetch("/.netlify/functions/send-message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ content: content.trim() }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Server error ${res.status}`);
    }
  } catch (err) {
    console.error("Send message failed:", err);
    showNotification(`Failed to send message: ${err.message}`, true);
  }
}

// ── Realtime subscription ──────────────────────────────────

/**
 * Subscribes to new messages via Supabase Realtime.
 * @param {Function} onNewMessage - called with each new message object
 */
export function subscribeToMessages(onNewMessage) {
  const supabase = getSupabase();

  realtimeChannel = supabase
    .channel("public:messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => onNewMessage(payload.new)
    )
    .subscribe();
}

export function unsubscribeFromMessages() {
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
    realtimeChannel = null;
  }
}
