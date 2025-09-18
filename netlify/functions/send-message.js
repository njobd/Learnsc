// netlify/functions/send-message.js
const { Redis } = require('@upstash/redis');
const fetch = require('node-fetch');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*", // use your domain in prod
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

    // Example: verify the user via Supabase
    const supabaseRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: event.headers.authorization || "",
        apikey: serviceKey
      }
    });

    if (!supabaseRes.ok) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    // TODO: your message handling logic here
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Internal error" }) };
  }
};
