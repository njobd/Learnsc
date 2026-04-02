// src/ui.js
// All DOM utility functions: notifications, connection status banner,
// toggling between the auth screen and the main app view.

let connectionCheckInterval = null;

// ── Notification toast ─────────────────────────────────────

/**
 * Show a toast notification at the bottom-right of the screen.
 * @param {string} message
 * @param {boolean} isError  - red styling when true, green when false
 * @param {number}  duration - ms before auto-hide (default 6000)
 */
export function showNotification(message, isError = true, duration = 6000) {
  const box = document.getElementById("notify");
  if (!box) return;
  box.textContent = message;
  box.style.display = "block";
  box.style.background = isError ? "#ffdddd" : "#ddffdd";
  box.style.color = isError ? "#a30000" : "#006600";
  box.style.borderColor = isError ? "#a30000" : "#006600";
  setTimeout(() => { box.style.display = "none"; }, duration);
}

// ── Connection status banner ───────────────────────────────

/**
 * Show the top-left connection status banner.
 * @param {string} message
 * @param {'warning'|'success'|'error'} type
 */
export function showConnectionStatus(message, type = "warning") {
  const status = document.getElementById("connectionStatus");
  if (!status) return;
  status.textContent = message;
  status.style.display = "block";

  switch (type) {
    case "error":
      status.style.background = "#ffdddd";
      status.style.color = "#a30000";
      break;
    case "success":
      status.style.background = "#ddffdd";
      status.style.color = "#006600";
      break;
    default:
      status.style.background = "#ffeb3b";
      status.style.color = "#333";
  }

  if (type === "success") {
    setTimeout(() => { status.style.display = "none"; }, 3000);
  }
}

export function hideConnectionStatus() {
  const status = document.getElementById("connectionStatus");
  if (status) status.style.display = "none";
}

// ── Auth ↔ App view toggle ─────────────────────────────────

export function showApp() {
  document.getElementById("authContainer").style.display = "none";
  document.getElementById("appContainer").style.display = "flex";
}

export function showAuth() {
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("authContainer").style.display = "flex";
}

// ── Periodic connection check ──────────────────────────────

/**
 * Starts a 30-second interval that re-checks the Supabase connection
 * only when the status banner is currently visible.
 * @param {Function} checkFn - the checkSupabaseConnection function from connection.js
 */
export function startConnectionPolling(checkFn) {
  connectionCheckInterval = setInterval(() => {
    const status = document.getElementById("connectionStatus");
    if (status && status.style.display !== "none") {
      checkFn();
    }
  }, 30_000);
}

export function stopConnectionPolling() {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
  }
}
