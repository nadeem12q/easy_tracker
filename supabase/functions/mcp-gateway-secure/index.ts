import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mcp-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const gatewayUrl = `${supabaseUrl}/functions/v1/mcp-gateway`;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const WRITE_ACTIONS = new Set([
  "mark_habits",
  "update_reflection",
  "set_sleep",
  "set_mood",
  "capture_day_update"
]);

const ANALYSIS_ACTIONS = new Set([
  "weekly_summary",
  "habit_consistency_report",
  "reflection_pattern_report",
  "missed_habits_report",
  "top_struggles_report",
  "recommended_focus_for_tomorrow",
  "daily_gap_analysis",
  "streak_risk_report",
  "momentum_report",
  "coaching_brief"
]);

const READ_ACTIONS = new Set([
  "who_am_i",
  "get_today_dashboard",
  ...ANALYSIS_ACTIONS
]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function getIp(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getToken(req: Request) {
  return (
    req.headers.get("x-mcp-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  ).trim();
}

function tokenPrefixFromHeader(header: string) {
  const raw = header.startsWith("mtk_") ? header.slice(4) : header;
  return raw.slice(0, 8) || null;
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

async function logSecurityEvent({
  userId,
  tokenId,
  tokenPrefix,
  requestIp,
  action,
  clientName,
  eventType,
  reason
}: {
  userId?: string | null;
  tokenId?: string | null;
  tokenPrefix?: string | null;
  requestIp?: string | null;
  action?: string | null;
  clientName?: string | null;
  eventType: "request" | "success" | "failure" | "blocked" | "failed_auth" | "suspicious";
  reason?: string | null;
}) {
  await admin.from("mcp_security_events").insert({
    user_id: userId ?? null,
    token_id: tokenId ?? null,
    token_prefix: tokenPrefix ?? null,
    request_ip: requestIp ?? null,
    action: action ?? null,
    client_name: clientName ?? null,
    event_type: eventType,
    reason: reason ?? null
  });
}

async function countEvents(filters: {
  requestIp?: string;
  tokenId?: string;
  tokenPrefix?: string | null;
  eventTypes?: string[];
  sinceMinutes: number;
  action?: string;
}) {
  const since = new Date(Date.now() - filters.sinceMinutes * 60 * 1000).toISOString();
  let query = admin
    .from("mcp_security_events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  if (filters.requestIp) query = query.eq("request_ip", filters.requestIp);
  if (filters.tokenId) query = query.eq("token_id", filters.tokenId);
  if (filters.tokenPrefix) query = query.eq("token_prefix", filters.tokenPrefix);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.eventTypes?.length) query = query.in("event_type", filters.eventTypes);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function authenticateToken(tokenHeader: string) {
  if (!tokenHeader) {
    throw new Error("Missing MCP token.");
  }

  const rawToken = tokenHeader.startsWith("mtk_") ? tokenHeader.slice(4) : tokenHeader;
  const tokenHash = await sha256Hex(rawToken);

  const { data: tokenRow, error } = await admin
    .from("mcp_api_tokens")
    .select("id,user_id,label,token_prefix,can_read,can_write,can_analyze,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (error || !tokenRow) {
    throw new Error("Invalid or expired MCP token.");
  }

  return tokenRow;
}

function assertScope(tokenInfo: any, action: string) {
  if (READ_ACTIONS.has(action) && !tokenInfo.can_read) {
    throw new Error("Is MCP token ko read access hasil nahin hai.");
  }
  if (WRITE_ACTIONS.has(action) && !tokenInfo.can_write) {
    throw new Error("Is MCP token ko write access hasil nahin hai.");
  }
  if (ANALYSIS_ACTIONS.has(action) && !tokenInfo.can_analyze) {
    throw new Error("Is MCP token ko analysis access hasil nahin hai.");
  }
}

async function assertRateLimits({ tokenInfo, tokenPrefix, requestIp, action }: any) {
  const recentTokenRequests = await countEvents({
    tokenId: tokenInfo.id,
    eventTypes: ["request", "success", "failure"],
    sinceMinutes: 1
  });
  if (recentTokenRequests >= 60) {
    throw new Error("Rate limit reached: 60 requests per minute per token.");
  }

  const recentIpRequests = await countEvents({
    requestIp,
    eventTypes: ["request", "success", "failure", "blocked"],
    sinceMinutes: 1
  });
  if (recentIpRequests >= 120) {
    throw new Error("Rate limit reached: too many requests from this IP.");
  }

  if (WRITE_ACTIONS.has(action)) {
    const writes = await countEvents({ tokenId: tokenInfo.id, eventTypes: ["success"], sinceMinutes: 1, action });
    if (writes >= 20) throw new Error("Write rate limit reached for this action.");
  }

  if (ANALYSIS_ACTIONS.has(action)) {
    const analytics = await countEvents({ tokenId: tokenInfo.id, eventTypes: ["success"], sinceMinutes: 1, action });
    if (analytics >= 30) throw new Error("Analytics rate limit reached for this action.");
  }

  const suspiciousFailures = await countEvents({
    requestIp,
    eventTypes: ["failed_auth", "blocked"],
    sinceMinutes: 10
  });
  if (suspiciousFailures >= 8) {
    await logSecurityEvent({
      userId: tokenInfo.user_id,
      tokenId: tokenInfo.id,
      tokenPrefix,
      requestIp,
      action,
      eventType: "suspicious",
      reason: "Repeated failed or blocked MCP attempts from same IP."
    });
    throw new Error("Suspicious activity guard triggered for this IP.");
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestIp = getIp(request);
  const tokenHeader = getToken(request);
  const tokenPrefix = tokenPrefixFromHeader(tokenHeader);
  let body: Record<string, any> = {};
  let tokenInfo: any = null;

  try {
    body = await request.json();
    const action = String(body.action ?? "");
    const clientName = body.client_name ?? "mcp-client";

    try {
      tokenInfo = await authenticateToken(tokenHeader);
    } catch (authError) {
      await logSecurityEvent({
        tokenPrefix,
        requestIp,
        action,
        clientName,
        eventType: "failed_auth",
        reason: authError instanceof Error ? authError.message : "Auth failed"
      });
      return json(401, { error: "Invalid or expired MCP token." });
    }

    assertScope(tokenInfo, action);
    await assertRateLimits({ tokenInfo, tokenPrefix: tokenInfo.token_prefix, requestIp, action });

    await logSecurityEvent({
      userId: tokenInfo.user_id,
      tokenId: tokenInfo.id,
      tokenPrefix: tokenInfo.token_prefix,
      requestIp,
      action,
      clientName,
      eventType: "request"
    });

    const gatewayResponse = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
        "x-mcp-token": tokenHeader
      },
      body: JSON.stringify(body)
    });

    const payload = await gatewayResponse.json();
    const success = gatewayResponse.ok && !payload?.error;

    await logSecurityEvent({
      userId: tokenInfo.user_id,
      tokenId: tokenInfo.id,
      tokenPrefix: tokenInfo.token_prefix,
      requestIp,
      action,
      clientName,
      eventType: success ? "success" : "failure",
      reason: success ? null : payload?.error || `Gateway status ${gatewayResponse.status}`
    });

    return json(gatewayResponse.status, payload);
  } catch (error) {
    await logSecurityEvent({
      userId: tokenInfo?.user_id ?? null,
      tokenId: tokenInfo?.id ?? null,
      tokenPrefix: tokenInfo?.token_prefix ?? tokenPrefix,
      requestIp,
      action: String(body.action ?? "unknown"),
      clientName: body.client_name ?? "mcp-client",
      eventType: "blocked",
      reason: error instanceof Error ? error.message : "Unknown security block"
    });

    return json(429, {
      error: error instanceof Error ? error.message : "Security guard blocked this request."
    });
  }
});
