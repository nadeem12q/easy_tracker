import { createInterface } from "node:readline";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const MCP_GATEWAY_URL =
  process.env.MCP_GATEWAY_URL ?? (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/mcp-gateway-secure` : "");

let authContext = null;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function fail(id, message) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message }
  });
}

function requireContext() {
  if (!authContext?.token) {
    throw new Error("Pehle `authenticate_with_token` tool se MCP token connect karein.");
  }
}

async function gatewayCall(action, args = {}) {
  requireContext();

  if (!MCP_GATEWAY_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY aur MCP gateway config required hai.");
  }

  const response = await fetch(MCP_GATEWAY_URL, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      "x-mcp-token": authContext.token
    },
    body: JSON.stringify({
      action,
      args,
      client_name: authContext.client_name ?? "metrack-mcp"
    })
  });

  const payload = await response.json();
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `MCP gateway error ${response.status}`);
  }

  return payload;
}

async function authenticateWithToken(argumentsObject) {
  if (!argumentsObject.token?.trim()) {
    throw new Error("Token required hai.");
  }

  authContext = {
    token: argumentsObject.token.trim(),
    client_name: argumentsObject.client_name?.trim() || "metrack-mcp"
  };

  const who = await gatewayCall("who_am_i", {});
  authContext.user = who;

  return {
    connected: true,
    client_name: authContext.client_name,
    secure_gateway: MCP_GATEWAY_URL.includes("mcp-gateway-secure"),
    ...who
  };
}

function signOut() {
  authContext = null;
  return { success: true };
}

function whoAmI() {
  requireContext();
  return {
    client_name: authContext.client_name,
    secure_gateway: MCP_GATEWAY_URL.includes("mcp-gateway-secure"),
    ...(authContext.user ?? {})
  };
}

async function listTools() {
  return {
    tools: [
      {
        name: "authenticate_with_token",
        description: "MeTrack MCP access token ke zariye secure session connect karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            token: { type: "string" },
            client_name: { type: "string" }
          },
          required: ["token"]
        }
      },
      {
        name: "sign_out",
        description: "Current MCP token session ko clear karta hai.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "who_am_i",
        description: "Current connected MeTrack account ki basic identity return karta hai.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_today_dashboard",
        description: "Aaj ya kisi date ka tracker state read karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string", description: "YYYY-MM-DD" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "mark_habits",
        description: "Habits ko done ya undone mark karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            habit_names: { type: "array", items: { type: "string" } },
            done: { type: "boolean" }
          },
          required: ["entry_date", "habit_names", "done"]
        }
      },
      {
        name: "update_reflection",
        description: "Reflection fields, gratitude aur notes save karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            patch: { type: "object" }
          },
          required: ["entry_date", "patch"]
        }
      },
      {
        name: "set_sleep",
        description: "Sleep aur wake-up times set karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            sleep_time: { type: "string" },
            wake_time: { type: "string" }
          },
          required: ["entry_date", "sleep_time", "wake_time"]
        }
      },
      {
        name: "set_mood",
        description: "Mood aur day rating update karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            mood_key: { type: "string" },
            day_rating: { type: "integer" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "weekly_summary",
        description: "Recent 7 din ka summary aur completion snapshot deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "habit_consistency_report",
        description: "Habits ki consistency, streaks aur completion rate report deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "reflection_pattern_report",
        description: "Mood, reflection usage aur sleep pattern ka readable report deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "missed_habits_report",
        description: "Kisi specific din ki woh habits batata hai jo abhi done nahin hui.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "top_struggles_report",
        description: "Recent days mein sab se weak habits identify karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" },
            limit: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "recommended_focus_for_tomorrow",
        description: "Recent pattern dekh kar kal ke liye short focus recommendations deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "capture_day_update",
        description: "Aik hi call mein habits, sleep, mood aur reflection fields update karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" },
            done_habits: { type: "array", items: { type: "string" } },
            undone_habits: { type: "array", items: { type: "string" } },
            sleep_time: { type: "string" },
            wake_time: { type: "string" },
            mood_key: { type: "string" },
            day_rating: { type: "integer" },
            screen_time: { type: "string" },
            patch: { type: "object" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "daily_gap_analysis",
        description: "Kisi specific din ka completion gap, missing fields aur missed habits analyze karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            entry_date: { type: "string" }
          },
          required: ["entry_date"]
        }
      },
      {
        name: "streak_risk_report",
        description: "Batata hai kaun si habits streak lose karne ke risk par hain.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "momentum_report",
        description: "Current aur previous window compare karke progress ya decline show karta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            window_days: { type: "integer" }
          },
          required: ["end_date"]
        }
      },
      {
        name: "coaching_brief",
        description: "Habits, reflections aur recent trend ko combine karke short coaching brief deta hai.",
        inputSchema: {
          type: "object",
          properties: {
            end_date: { type: "string" },
            days: { type: "integer" }
          },
          required: ["end_date"]
        }
      }
    ]
  };
}

async function callTool(name, args) {
  switch (name) {
    case "authenticate_with_token":
      return authenticateWithToken(args);
    case "sign_out":
      return signOut();
    case "who_am_i":
      return whoAmI();
    default:
      return gatewayCall(name, args);
  }
}

const lineReader = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

lineReader.on("line", async (line) => {
  if (!line.trim()) return;

  try {
    const message = JSON.parse(line);

    if (message.method === "initialize") {
      ok(message.id, {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "metrack-mcp",
          version: "0.3.0"
        },
        capabilities: {
          tools: {}
        }
      });
      return;
    }

    if (message.method === "tools/list") {
      ok(message.id, await listTools());
      return;
    }

    if (message.method === "tools/call") {
      const output = await callTool(message.params.name, message.params.arguments || {});
      ok(message.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2)
          }
        ]
      });
      return;
    }

    fail(message.id, `Unsupported method: ${message.method}`);
  } catch (error) {
    fail(message.id ?? null, error.message);
  }
});
