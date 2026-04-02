const { Redis } = require('@upstash/redis');
const fetch = require('node-fetch');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "OPTIONS, POST"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE;
    if (!serviceKey) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Server misconfigured" }) };
    }

    // 1. Verify the user's token with Supabase
    const supabaseRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: event.headers.authorization || "",
        apikey: serviceKey
      }
    });

    if (!supabaseRes.ok) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    const user = await supabaseRes.json();

    // 2. Parse and validate the message body
    let content;
    try {
      ({ content } = JSON.parse(event.body));
    } catch {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid request body" }) };
    }

    if (!content || !content.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Message cannot be empty" }) };
    }

    // 3. Save the message to Supabase
    const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        user_id: user.id,
        username: user.user_metadata?.username,
        content: content.trim()
      })
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      console.error("Supabase insert failed:", err);
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Failed to save message" }) };
    }

    // 4. Optionally publish to Redis for any pub/sub consumers
    await redis.lpush("messages:recent", JSON.stringify({
      user_id: user.id,
      username: user.user_metadata?.username,
      content: content.trim(),
      created_at: new Date().toISOString()
    }));
    await redis.ltrim("messages:recent", 0, 99); // keep last 100 messages in Redis

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error("send-message error:", err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Internal error" }) };
  }
};
