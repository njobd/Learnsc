// src/bootstrap.js
// Initializes the Supabase client once and exports a safe getter.
// All other modules import getSupabase() instead of reading window.supabase.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let _client = null;

if (!supabaseUrl || !supabaseKey) {
  // Only log in development — remove noisy key-existence logs from production
  if (import.meta.env.DEV) {
    console.error("❌ Supabase env vars missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
} else {
  _client = createClient(supabaseUrl, supabaseKey);
  if (import.meta.env.DEV) {
    console.log("✅ Supabase initialized:", supabaseUrl);
  }
}

/**
 * Returns the initialized Supabase client.
 * Throws clearly if called before the client is ready (e.g. missing env vars).
 */
export function getSupabase() {
  if (!_client) {
    throw new Error("Supabase client not initialized — check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Netlify env vars.");
  }
  return _client;
}
