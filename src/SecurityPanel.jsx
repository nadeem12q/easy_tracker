import { useEffect, useMemo, useState } from "react";
import {
  createMcpToken,
  listMcpAuditLogs,
  listMcpSecurityEvents,
  listMcpTokens,
  revokeMcpToken
} from "./securityApi.js";

const EXPIRY_OPTIONS = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
  { label: "1 year", value: "365" },
  { label: "Custom", value: "custom" }
];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function toLocalDateTimeInput(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function expiryToIso(expiryMode, customValue) {
  if (expiryMode === "custom") {
    if (!customValue) return null;
    return new Date(customValue).toISOString();
  }

  const days = Number(expiryMode || 90);
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function formatDateTime(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function ScopeBadge({ active, children }) {
  return <span className={cx("scope-badge", active && "active")}>{children}</span>;
}

export default function SecurityPanel({ setFeedback }) {
  const [tokens, setTokens] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [securityEvents, setSecurityEvents] = useState([]);
  const [label, setLabel] = useState("Primary Agent");
  const [expiryMode, setExpiryMode] = useState("90");
  const [customExpiry, setCustomExpiry] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 90);
    return toLocalDateTimeInput(date);
  });
  const [scopes, setScopes] = useState({ read: true, write: true, analyze: true });
  const [createdToken, setCreatedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("tokens");

  const expiryPreview = useMemo(() => {
    const iso = expiryToIso(expiryMode, customExpiry);
    return iso ? formatDateTime(iso) : "Invalid expiry";
  }, [expiryMode, customExpiry]);

  async function refreshSecurityData() {
    const [nextTokens, nextAuditLogs, nextSecurityEvents] = await Promise.all([
      listMcpTokens(),
      listMcpAuditLogs(30),
      listMcpSecurityEvents(30)
    ]);
    setTokens(nextTokens);
    setAuditLogs(nextAuditLogs);
    setSecurityEvents(nextSecurityEvents);
  }

  useEffect(() => {
    refreshSecurityData().catch((error) => {
      setFeedback?.({ type: "error", message: error.message });
    });
  }, []);

  async function handleCreateToken() {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (!scopes.read && !scopes.write && !scopes.analyze) {
      setFeedback?.({ type: "error", message: "Kam az kam aik scope select karna zaroori hai." });
      return;
    }

    setBusy(true);
    try {
      const created = await createMcpToken({
        label: trimmed,
        canRead: scopes.read,
        canWrite: scopes.write,
        canAnalyze: scopes.analyze,
        expiresAt: expiryToIso(expiryMode, customExpiry)
      });
      setCreatedToken(created.token);
      await refreshSecurityData();
      setFeedback?.({
        type: "success",
        message: "Secure MCP token generate ho gaya. Isay abhi copy kar lein; baad mein full token dobara show nahin hoga."
      });
    } catch (error) {
      setFeedback?.({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeToken(tokenId) {
    setBusy(true);
    try {
      await revokeMcpToken(tokenId);
      await refreshSecurityData();
      setFeedback?.({ type: "success", message: "MCP token revoke kar diya gaya." });
    } catch (error) {
      setFeedback?.({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="security-panel">
      <div className="section-divider" />
      <span className="field-label">MCP Security Center</span>
      <div className="subtle-note">
        Yahan se agent tokens create, expire, scope-limit, revoke aur audit monitor kar sakte hain.
      </div>

      <div className="security-tabs">
        <button type="button" className={cx("tag-button", tab === "tokens" && "active")} onClick={() => setTab("tokens")}>Tokens</button>
        <button type="button" className={cx("tag-button", tab === "audit" && "active")} onClick={() => setTab("audit")}>Audit Logs</button>
        <button type="button" className={cx("tag-button", tab === "events" && "active")} onClick={() => setTab("events")}>Security Events</button>
        <button type="button" className="tag-button" onClick={refreshSecurityData} disabled={busy}>Refresh</button>
      </div>

      {tab === "tokens" ? (
        <div className="security-stack">
          <div className="panel-row">
            <label>
              <span className="field-label">Token Label</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Primary Agent" />
            </label>
            <label>
              <span className="field-label">Expiry</span>
              <select value={expiryMode} onChange={(event) => setExpiryMode(event.target.value)}>
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          {expiryMode === "custom" ? (
            <label>
              <span className="field-label">Custom Expiry</span>
              <input type="datetime-local" value={customExpiry} onChange={(event) => setCustomExpiry(event.target.value)} />
            </label>
          ) : null}

          <div className="subtle-note">Expiry preview: {expiryPreview}</div>

          <div>
            <span className="field-label">Scopes</span>
            <div className="scope-grid">
              <label className="scope-toggle">
                <input type="checkbox" checked={scopes.read} onChange={(event) => setScopes((current) => ({ ...current, read: event.target.checked }))} />
                <span>Read tracker</span>
              </label>
              <label className="scope-toggle">
                <input type="checkbox" checked={scopes.write} onChange={(event) => setScopes((current) => ({ ...current, write: event.target.checked }))} />
                <span>Update tracker</span>
              </label>
              <label className="scope-toggle">
                <input type="checkbox" checked={scopes.analyze} onChange={(event) => setScopes((current) => ({ ...current, analyze: event.target.checked }))} />
                <span>Run analytics</span>
              </label>
            </div>
          </div>

          <button type="button" className="action" onClick={handleCreateToken} disabled={busy}>
            {busy ? "Working..." : "Generate Secure Token"}
          </button>

          {createdToken ? (
            <div className="token-box">
              <strong>New Token - one time visible</strong>
              <code>{createdToken}</code>
            </div>
          ) : null}

          <div className="token-list">
            {tokens.length ? tokens.map((token) => (
              <div key={token.id} className="token-row">
                <div>
                  <strong>{token.label}</strong>
                  <div className="subtle-note">
                    Prefix: {token.token_prefix} | Expires: {formatDateTime(token.expires_at)} | Last used: {formatDateTime(token.last_used_at)}
                  </div>
                  <div className="scope-badges">
                    <ScopeBadge active={token.can_read}>read</ScopeBadge>
                    <ScopeBadge active={token.can_write}>write</ScopeBadge>
                    <ScopeBadge active={token.can_analyze}>analyze</ScopeBadge>
                  </div>
                </div>
                <button type="button" className="action secondary" onClick={() => handleRevokeToken(token.id)} disabled={busy}>Revoke</button>
              </div>
            )) : <div className="subtle-note">Abhi koi active MCP token nahin hai.</div>}
          </div>
        </div>
      ) : null}

      {tab === "audit" ? (
        <div className="audit-list">
          {auditLogs.length ? auditLogs.map((log) => (
            <div key={log.id} className={cx("audit-row", log.success ? "success" : "error")}>
              <div>
                <strong>{log.action}</strong>
                <div className="subtle-note">{formatDateTime(log.created_at)} | {log.client_name || "mcp-client"} | token {log.token_prefix || "n/a"}</div>
                {log.error_message ? <div className="subtle-note">Error: {log.error_message}</div> : null}
              </div>
              <span className="pill">{log.success ? "success" : "failed"}</span>
            </div>
          )) : <div className="subtle-note">Abhi audit logs nahin hain.</div>}
        </div>
      ) : null}

      {tab === "events" ? (
        <div className="audit-list">
          {securityEvents.length ? securityEvents.map((event) => (
            <div key={event.id} className={cx("audit-row", ["blocked", "failed_auth", "suspicious"].includes(event.event_type) ? "error" : "success")}>
              <div>
                <strong>{event.event_type}</strong>
                <div className="subtle-note">{formatDateTime(event.created_at)} | action {event.action || "n/a"} | IP {event.request_ip || "n/a"}</div>
                {event.reason ? <div className="subtle-note">Reason: {event.reason}</div> : null}
              </div>
              <span className="pill">{event.token_prefix || "no-token"}</span>
            </div>
          )) : <div className="subtle-note">Abhi security events nahin hain.</div>}
        </div>
      ) : null}
    </div>
  );
}
