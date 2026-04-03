// src/auth.js
// Handles all authentication flows: login, signup, logout.
// Calls Supabase RPC functions that must exist in your Supabase project.

import { getSupabase } from "./bootstrap.js";
import { showNotification, hideConnectionStatus, showApp } from "./ui.js";
import { checkSupabaseConnection } from "./connection.js";

// ── Login ──────────────────────────────────────────────────

/**
 * Attempts to log in with username + password via Supabase RPC.
 * Requires a `login_user(_username, _password)` function in Supabase.
 */
export async function handleLogin(username, password) {
  const loginBtn = document.querySelector('#loginForm button[type="submit"]');
  const inputs = document.querySelectorAll("#loginForm input");

  try {
    // Disable form during request
    loginBtn.textContent = "Signing In...";
    loginBtn.disabled = true;
    inputs.forEach((input) => (input.disabled = true));

    // Verify connection before attempting login
    const isConnected = await checkSupabaseConnection();
    if (!isConnected) throw new Error("CONNECTION_FAILED");

    // Client-side validation
    if (!username || username.length < 3) {
      throw new Error("Username must be at least 3 characters long");
    }
    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters long");
    }

    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("login_user", {
      _username: username.trim(),
      _password: password,
    });

    if (error) {
      if (error.message.includes("function login_user") && error.message.includes("does not exist")) {
        throw new Error(
          "LOGIN_FUNCTION_MISSING: Database function 'login_user' not found.\n\nPlease ensure all database functions are created in Supabase."
        );
      }
      throw new Error(`LOGIN_RPC_ERROR: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new Error("Invalid username or password.\n\nPlease check your credentials and try again.");
    }

    // Success
    hideConnectionStatus();
    showNotification(`Welcome back, ${data[0].username}!`, false);
    showApp();

    return data[0]; // return the user object for main.js to store

  } catch (err) {
    let userMessage;

    if (err.message === "CONNECTION_FAILED") {
      userMessage = "Cannot connect to server. Please check your connection and try again.";
    } else if (err.message.includes("LOGIN_FUNCTION_MISSING")) {
      userMessage = err.message;
    } else if (err.message.includes("Failed to fetch")) {
      userMessage = "Network error occurred.\n\nPossible fixes:\n• Check internet connection\n• Refresh the page\n• Try again in a few moments";
    } else if (err.message.includes("LOGIN_RPC_ERROR")) {
      userMessage = `Login failed: ${err.message.replace("LOGIN_RPC_ERROR: ", "")}`;
    } else {
      userMessage = err.message;
    }

    showNotification(userMessage, true);
    console.error("Login error:", err);
    return null;

  } finally {
    loginBtn.textContent = "Sign In";
    loginBtn.disabled = false;
    inputs.forEach((input) => (input.disabled = false));
  }
}

// ── Logout ─────────────────────────────────────────────────

export async function handleLogout() {
  try {
    const supabase = getSupabase();
    await supabase.auth.signOut();
  } catch (err) {
    console.error("Logout error:", err);
  }
}
