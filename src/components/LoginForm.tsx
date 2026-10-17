"use client";

import { useState, type FormEvent } from "react";
import { Card, PrimaryButton, inputStyle, labelStyle } from "./ui";

export function LoginForm({ next }: { next: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        // A full navigation, not a client-side push, so the app loads fresh
        // with the new session cookie.
        window.location.assign(next);
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.error || `Sign-in failed (${res.status})`);
      setPassword("");
    } catch {
      setError("Couldn't reach the server — check your connection and try again");
    }
    setSubmitting(false);
  }

  const fieldStyle = { ...inputStyle, width: "100%", fontSize: 14, padding: "10px 12px" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 18, textAlign: "center" }}>
          PennyTrail
        </div>
        <Card style={{ padding: 24 }}>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label>
              <div style={labelStyle}>Username</div>
              <input
                name="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={fieldStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Password</div>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={fieldStyle}
              />
            </label>
            {error && (
              <div role="alert" style={{ fontSize: 13, color: "var(--attention)" }}>
                {error}
              </div>
            )}
            <PrimaryButton type="submit" disabled={submitting || !username || !password}>
              {submitting ? "Signing in…" : "Sign in"}
            </PrimaryButton>
          </form>
        </Card>
      </div>
    </div>
  );
}
