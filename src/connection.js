// src/connection.js
// Handles checking whether the Supabase connection is healthy
// and surfacing clear error messages to the user.

import { getSupabase } from "./bootstrap.js";
import { showConnectionStatus, showNotification } from "./ui.js";

/**
 * Pings Supabase with a lightweight query to verify connectivity.
 * Updates the status banner and shows a notification on failure.
 * @returns {Promise<boolean>} true if connected, false otherwise
 */
export async function checkSupabaseConnection() {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from("users")
      .select("count")
      .limit(1);

    if (error) throw new Error(`SUPABASE_ERROR: ${error.message}`);

    showConnectionStatus("Connected", "success");
    return true;

  } catch (err) {
    let errorMessage = "Connection Error: ";
    let suggestions = "";

    if (err.message.includes("Supabase client not initialized")) {
      errorMessage += "Supabase client not found";
      suggestions = "\n\nPossible fixes:\n• Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify env vars\n• Check the browser console for details";
    } else if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      errorMessage += "Network connection failed";
      suggestions = "\n\nPossible fixes:\n• Check your internet connection\n• Verify your Supabase project is active\n• Check that your domain is whitelisted in Supabase\n• Ensure HTTPS is being used";
    } else if (err.message.includes("CORS")) {
      errorMessage += "CORS policy error";
      suggestions = "\n\nFix: Add your domain to Supabase CORS settings";
    } else if (err.message.includes("relation") && err.message.includes("does not exist")) {
      errorMessage += "Database table missing";
      suggestions = "\n\nFix: Create the required tables in your Supabase project";
    } else {
      errorMessage += err.message;
      suggestions = "\n\nCheck the browser console for more details";
    }

    showConnectionStatus("Connection Failed", "error");
    showNotification(errorMessage + suggestions, true, 10_000);
    return false;
  }
}
