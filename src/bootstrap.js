import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase client not initialized. Missing environment variables.");
  console.error("supabaseUrl resolved to:", supabaseUrl);
  console.error("supabaseKey exists?:", !!supabaseKey);
} else {
  window.supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase initialized successfully");
}
