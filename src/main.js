// src/main.js

// ✅ Initialize Supabase client first
import './bootstrap.js'

// Example usage: test a Supabase query after bootstrap is ready
document.addEventListener("DOMContentLoaded", async () => {
  if (!window.supabase) {
    console.error("❌ Supabase client not initialized");
    return;
  }

  console.log("✅ Supabase client is ready:", window.supabase);

  try {
    // Replace "messages" with a real table from your Supabase project
    const { data, error } = await window.supabase.from("messages").select("*");
    if (error) throw error;
    console.log("Fetched rows:", data);
  } catch (err) {
    console.error("Supabase query failed:", err.message);
  }
});
