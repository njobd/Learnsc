// src/bootstrap.js
import { createClient } from "@supabase/supabase-js";

/*
  At build time we will inline process.env.SUPABASE_URL and
  process.env.SUPABASE_ANON_KEY into the bundled file.
*/
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Error: SUPABASE_URL or SUPABASE_ANON_KEY missing. Please check your environment variables.");
} else {
  // Create global client (same API your app expects)
  window.supabase = createClient(supabaseUrl, supabaseKey);
  console.log("Supabase initialized successfully");
}
