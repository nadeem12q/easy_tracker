import { createInterface } from "node:readline";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const MCP_GATEWAY_URL =
  process.env.MCP_GATEWAY_URL ?? (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/mcp-gateway-secure` : "");

let authContext = null;

const TOOL_DEFINITIONS = [
  ["get_today_dashboard", "Aaj ya kisi date ka tracker state read karta hai.", { entry_date: "string" }, ["entry_date"]],
  ["mark_habits", "Habits ko done ya undone mark karta hai.", { entry_date: "string", habit_names: "array:string", done: "boolean" }, ["entry_date", "habit_names", "done"]],
  ["update_reflection", "Reflection fields, gratitude aur notes save karta hai.", { entry_date: "string", patch: "object" }, ["entry_date", "patch"]],
  ["set_sleep", "Sleep aur wake-up times set karta hai.", { entry_date: "string", sleep_time: "string", wake_time: "string" }, ["entry_date", "sleep_time", "wake_time"]],
  ["set_mood", "Mood aur day rating update karta hai.", { entry_date: "string", mood_key: "string", day_rating: "integer" }, ["entry_date"]],
  ["weekly_summary", "Recent 7 din ka summary aur completion snapshot deta hai.", { end_date: "string" }, ["end_date"]],
  ["habit_consistency_report", "Habits ki consistency, streaks aur completion rate report deta hai.", { end_date: "string", days: "integer" }, ["end_date"]],
  ["reflection_pattern_report", "Mood, reflection usage aur sleep pattern ka readable report deta hai.", { end_date: "string", days: "integer" }, ["end_date"]],
  ["missed_habits_report", "Kisi specific din ki woh habits batata hai jo abhi done nahin hui.", { entry_date: "string" }, ["entry_date"]],
  ["top_struggles_report", "Recent days mein sab se weak habits identify karta hai.", { end_date: "string", days: "integer", limit: "integer" }, ["end_date"]],
  ["recommended_focus_for_tomorrow", "Recent pattern dekh kar kal ke liye short focus recommendations deta hai.", { end_date: "string", days: "integer" }, ["end_date"]],
  ["capture_day_update", "Aik hi call mein habits, sleep, mood aur reflection fields update karta hai.", { entry_date: "string", done_habits: "array:string", undone_habits: "array:string", sleep_time: "string", wake_time: "string", mood_key: "string", day_rating: "integer", screen_time: "string", patch: "object" }, ["entry_date"]],
  ["daily_gap_analysis", "Kisi specific din ka completion gap, missing fields aur missed habits analyze karta hai.", { entry_date: "string" }, ["entry_date"]],
  ["streak_risk_report", "Batata hai kaun si habits streak lose karne ke risk par hain.", { end_date: "string", days: "integer" }, ["end_date"]],
  ["momentum_report", "Current aur previous window compare karke progress ya decline show karta hai.", { end_date: "string", window_days: "integer" }, ["end_date"]],
  ["coaching_brief", "Habits, reflections aur recent trend ko combine karke short coaching brief deta hai.", { end_date: "string", days: "integer" }, ["end_date"]],
  ["list_reminder_logs", "Recent reminder logs read karta hai: fired, yes, no, later, missed etc.", { limit: "integer" }, []],
  ["reminder_missed_report", "Repeat-day reminders ke hisaab se missed reminders/habits report deta hai.", { end_date: "string", days: "integer" }, []],
  ["reminder_effectiveness_report", "Reminder response effectiveness batata hai: fired, yes, no, later, missed, response rate.", { days: "integer" }, []]
];

const REMINDER_RPC_TOOLS = new Set([
  "list_reminder_logs",
  "reminder_missed_report",
  "reminder_effectiveness_report"
]);

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function fail(id, message) {
  writeMessage({ jsonrpc: "2.0", id, error: { code: -32000, message } });
}

function requireContext() {
  if (!authContext?.token) {
    throw new Error("Pehle `authenticate_with_token` tool se MCP token connect karein.");
  }
}

function propertySchema(type) {
  if (type === "array:string") return { type: "array", items: { type: "string" } };
  return { type };
}

function makeTool(name, description, properties = {}, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, propertySchema(value)])),
      required
    }
  };
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
    body: JSON.stringify({ action, args, client_name: authContext.client_name ?? "metrack-mcp" })
  });
  const payload = await response.json();
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `MCP gateway error ${response.status}`);
  }
  return payload;
}

async function rpcCall(functionName, body) {
  requireContext();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL aur SUPABASE_ANON_KEY required hain.");
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || payload?.error) {
    throw new Error(payload?.message || payload?.error || `Supabase RPC error ${response.status}`);
  }
  return payload;
}

async function reminderRpcTool(name, args = {}) {
  if (name === "list_reminder_logs") {
    return { logs: await rpcCall("mcp_list_reminder_logs", { input_token: authContext.token, max_rows: args.limit ?? 50 }) };
  }
  if (name === "reminder_missed_report") {
    return rpcCall("mcp_reminder_missed_report", {
      input_token: authContext.token,
      end_date: args.end_date ?? new Date().toISOString().slice(0, 10),
      days: args.days ?? 14
    });
  }
  if (name === "reminder_effectiveness_report") {
    return rpcCall("mcp_reminder_effectiveness_report", { input_token: authContext.token, days: args.days ?? 14 });
  }
  throw new Error(`Unsupported reminder RPC tool: ${name}`);
}

async function authenticateWithToken(args) {
  if (!args.token?.trim()) throw new Error("Token required hai.");
  authContext = { token: args.token.trim(), client_name: args.client_name?.trim() || "metrack-mcp" };
  const who = await gatewayCall("who_am_i", {});
  authContext.user = who;
  return {
    connected: true,
    client_name: authContext.client_name,
    secure_gateway: MCP_GATEWAY_URL.includes("mcp-gateway-secure"),
    reminder_analytics_rpc: true,
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
    reminder_analytics_rpc: true,
    ...(authContext.user ?? {})
  };
}

async function listTools() {
  return {
    tools: [
      makeTool("authenticate_with_token", "MeTrack MCP access token ke zariye secure session connect karta hai.", { token: "string", client_name: "string" }, ["token"]),
      makeTool("sign_out", "Current MCP token session ko clear karta hai."),
      makeTool("who_am_i", "Current connected MeTrack account ki basic identity return karta hai."),
      ...TOOL_DEFINITIONS.map(([name, description, properties, required]) => makeTool(name, description, properties, required))
    ]
  };
}

async function callTool(name, args) {
  if (name === "authenticate_with_token") return authenticateWithToken(args);
  if (name === "sign_out") return signOut();
  if (name === "who_am_i") return whoAmI();
  if (REMINDER_RPC_TOOLS.has(name)) return reminderRpcTool(name, args);
  return gatewayCall(name, args);
}

const lineReader = createInterface({ input: process.stdin, crlfDelay: Infinity });

lineReader.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      ok(message.id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "metrack-mcp", version: "0.4.0" },
        capabilities: { tools: {} }
      });
      return;
    }
    if (message.method === "tools/list") {
      ok(message.id, await listTools());
      return;
    }
    if (message.method === "tools/call") {
      const output = await callTool(message.params.name, message.params.arguments || {});
      ok(message.id, { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] });
      return;
    }
    fail(message.id, `Unsupported method: ${message.method}`);
  } catch (error) {
    fail(message.id ?? null, error.message);
  }
});
