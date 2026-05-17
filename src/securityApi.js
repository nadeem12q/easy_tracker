import { getSupabaseClient, hasSupabaseConfig } from "./supabase.js";

async function sha256Hex(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function createSecureToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

async function requireSignedInSupabase() {
  if (!hasSupabaseConfig) {
    throw new Error("Security tools ke liye Supabase config aur signed-in account zaroori hai.");
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) {
    throw new Error("Security tools use karne ke liye pehle login karein.");
  }

  return supabase;
}

export async function listMcpTokens() {
  const supabase = await requireSignedInSupabase();
  const { data, error } = await supabase
    .from("mcp_api_tokens")
    .select("id,label,token_prefix,can_read,can_write,can_analyze,expires_at,last_used_at,revoked_at,created_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createMcpToken({
  label,
  canRead = true,
  canWrite = true,
  canAnalyze = true,
  expiresAt
}) {
  const supabase = await requireSignedInSupabase();
  const rawToken = createSecureToken();
  const tokenHash = await sha256Hex(rawToken);
  const tokenPrefix = rawToken.slice(0, 8);

  const { data, error } = await supabase
    .from("mcp_api_tokens")
    .insert({
      label,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      can_read: canRead,
      can_write: canWrite,
      can_analyze: canAnalyze,
      ...(expiresAt ? { expires_at: expiresAt } : {})
    })
    .select("id,label,token_prefix,can_read,can_write,can_analyze,expires_at,last_used_at,revoked_at,created_at")
    .single();

  if (error) throw error;

  return {
    token: `mtk_${rawToken}`,
    record: data
  };
}

export async function revokeMcpToken(tokenId) {
  const supabase = await requireSignedInSupabase();
  const { error } = await supabase
    .from("mcp_api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId);

  if (error) throw error;
}

export async function listMcpAuditLogs(limit = 30) {
  const supabase = await requireSignedInSupabase();
  const { data, error } = await supabase
    .from("mcp_audit_log_view")
    .select("id,token_id,token_label,token_prefix,action,client_name,success,detail,error_message,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function listMcpSecurityEvents(limit = 30) {
  const supabase = await requireSignedInSupabase();
  const { data, error } = await supabase
    .from("mcp_security_events")
    .select("id,token_id,token_prefix,request_ip,action,client_name,event_type,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
