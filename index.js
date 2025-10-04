import fs from "fs";
import fetch from "node-fetch";

const API_URL = "https://qevcpuebfogiqtyrxfpv.supabase.co";
const API_KEY = "sb_publishable_y0JX5vySxUoPYWT9yoROlA_1_uCXOSl";
const INTERVAL = 60 * 1000; // ⏱️ every 30 seconds

// ==== LOAD ACCOUNTS ====
let accounts = fs.readFileSync("accounts.json", "utf-8")
  .split("\n")
  .filter(Boolean)
  .map(line => {
    const parts = line.split(":");
    return {
      email: parts[0],
      password: parts[1],
      installId: parts[2] || null // can be empty, auto-fetch later
    };
  });

// ==== AUTH FUNCTIONS ====
async function login(account) {
  try {
    const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: API_KEY,
        authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        gotrue_meta_security: {}
      })
    });

    if (!res.ok) {
      console.log(`❌ Login failed for ${account.email}`);
      return null;
    }

    const data = await res.json();
    account.token = data.access_token;
    account.refreshToken = data.refresh_token;
    account.user_id = data.user?.id;
    account.expiresIn = Date.now() + data.expires_in * 1000;
    console.log(`✅ Logged in: ${account.email}`);

    // Auto-fetch installId if missing
    if (!account.installId) {
      account.installId = await fetchInstallId(account);
      console.log(`🆔 Fetched installId for ${account.email}: ${account.installId}`);
    }

    return account;
  } catch (err) {
    console.log(`❌ Error logging in ${account.email}:`, err.message);
    return null;
  }
}

async function refreshToken(account) {
  try {
    const res = await fetch(`${API_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: API_KEY,
        authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({ refresh_token: account.refreshToken })
    });

    if (!res.ok) {
      console.log(`❌ Refresh failed for ${account.email}, logging in again`);
      return await login(account);
    }

    const data = await res.json();
    account.token = data.access_token;
    account.refreshToken = data.refresh_token;
    account.expiresIn = Date.now() + data.expires_in * 1000;
    console.log(`🔄 Token refreshed for ${account.email}`);
    return account;
  } catch (err) {
    console.log(`❌ Error refreshing token for ${account.email}:`, err.message);
    return await login(account);
  }
}

// ==== INSTALL ID FETCH ====
async function fetchInstallId(account) {
  try {
    // This endpoint is an example: replace if your system uses a different one
    const res = await fetch(`${API_URL}/rest/v1/rpc/get_install_id`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: API_KEY,
        authorization: `Bearer ${account.token}`
      },
      body: JSON.stringify({ p_user_id: account.user_id })
    });

    if (!res.ok) return "UNKNOWN";
    const data = await res.json();
    return data?.installId || "UNKNOWN";
  } catch (err) {
    console.log(`❌ Failed to fetch installId for ${account.email}:`, err.message);
    return "UNKNOWN";
  }
}

// ==== SUPABASE FUNCTIONS ====
async function sendHeartbeat(account) {
  try {
    const res = await fetch(`${API_URL}/functions/v1/heartbeat`, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        apikey: API_KEY,
        authorization: `Bearer ${account.token}`,
        "x-client-info": "supabase-js-node/2.39.1"
      },
      body: JSON.stringify({ installId: account.installId })
    });
    return res.status;
  } catch (err) {
    console.log(`❌ Heartbeat failed for ${account.email}:`, err.message);
    return null;
  }
}

async function getEarnings(account) {
  try {
    const res = await fetch(`${API_URL}/rest/v1/rpc/get_user_earnings_last_24h`, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        apikey: API_KEY,
        authorization: `Bearer ${account.token}`,
        "content-profile": "internal",
        "x-client-info": "supabase-js-node/2.39.1"
      },
      body: JSON.stringify({ p_user_id: account.user_id })
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.log(`❌ Failed to get earnings for ${account.email}:`, err.message);
    return null;
  }
}

// ==== MAIN LOOP ====
async function run() {
  for (const [i, account] of accounts.entries()) {
    if (!account.token || Date.now() > account.expiresIn) {
      await refreshToken(account);
    }

    const hb = await sendHeartbeat(account);
    const earnings = await getEarnings(account);

    console.log(
      `[${new Date().toLocaleTimeString()}] [Acc ${i + 1}] ${account.email}`
    );
    console.log(`💓 Heartbeat: ${hb}`);
    console.log(`💰 Earnings (24h):`, earnings);
  }

  // Save updated tokens & installIds back to file
  fs.writeFileSync(
    "accounts.json",
    accounts.map(acc => `${acc.email}:${acc.password}:${acc.installId}`).join("\n")
  );
}

// ==== START ====
(async () => {
  for (const acc of accounts) {
    await login(acc);
  }

  // Save any new installIds
  fs.writeFileSync(
    "accounts.json",
    accounts.map(acc => `${acc.email}:${acc.password}:${acc.installId}`).join("\n")
  );

  console.log("🚀 Supabase bot started (30s interval)...");
  run();
  setInterval(run, INTERVAL);
})();
