"use client";

import { useId, useState } from "react";

import { useToast } from "@/components/dashboard/toast";
import type { ApiTokenMeta } from "@/lib/blog/types";

/** POST /api/api-tokens response: metadata plus the once-only token value. */
type CreatedToken = ApiTokenMeta & { token: string };

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (typeof body === "object" && body !== null) {
      const { message, error } = body as { message?: unknown; error?: unknown };
      if (typeof message === "string" && message) return message;
      if (typeof error === "string" && error) return error;
    }
  } catch {
    // Non-JSON error bodies fall through to the fallback.
  }

  return fallback;
}

function formatWhen(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/**
 * Blog API token management. Tokens are created here, shown ONCE, and revoked
 * here — this card is the owner's kill switch for any misbehaving agent, and
 * last_used_at is the activity signal the spec's risk section leans on.
 */
export default function ApiTokensCard({
  initialTokens,
}: {
  initialTokens: ApiTokenMeta[];
}) {
  const showToast = useToast();
  const nameId = useId();

  const [tokens, setTokens] = useState<ApiTokenMeta[]>(initialTokens);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  /** Two-step revoke: first click arms, second click fires. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    if (creating || !name.trim()) return;

    setCreating(true);

    try {
      const response = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not create the token."));
      }

      const token: CreatedToken = await response.json();
      const { token: _secret, ...meta } = token;

      setTokens((previous) => [meta, ...previous]);
      setCreated(token);
      setName("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not create the token.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast("Token copied");
    } catch {
      showToast("Copy failed — select and copy it manually.");
    }
  }

  async function handleRevoke(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }

    setConfirmingId(null);

    try {
      const response = await fetch(`/api/api-tokens/${id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Could not revoke the token."));
      }

      const revokedAt = new Date().toISOString();

      setTokens((previous) =>
        previous.map((t) => (t.id === id ? { ...t, revoked_at: revokedAt } : t))
      );
      showToast("Token revoked");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not revoke the token.");
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow">
      <h2 className="font-heading text-[17px] font-semibold">Blog API tokens</h2>
      <p className="mt-1 text-[13px] text-text-2">
        Agents authenticate to the blog API with these. Scope: blog posts and media
        only. Revocation is immediate.
      </p>

      <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor={nameId} className="sr-only">
          Token name
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          placeholder="Token name, e.g. Claude — blog"
          className="h-[34px] min-w-[220px] flex-1 rounded-[9px] border border-border-2 bg-surface-2 px-[10px] text-[13px] text-text"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="inline-flex h-[34px] cursor-pointer items-center rounded-[9px] bg-accent px-[14px] text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Create token
        </button>
      </form>

      {created && (
        <div className="mt-3 rounded-[9px] border border-accent bg-accent-soft p-3">
          <p className="text-[13px] font-semibold text-text">
            Copy this token now — it will not be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded border border-border bg-surface px-2 py-1 font-mono text-xs">
              {created.token}
            </code>
            <button
              type="button"
              onClick={() => handleCopy(created.token)}
              className="h-[30px] cursor-pointer rounded-[7px] border border-border bg-surface px-3 text-[12px] font-semibold"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="h-[30px] cursor-pointer rounded-[7px] border border-border bg-surface px-3 text-[12px]"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <ul className="mt-4 list-none divide-y divide-border">
        {tokens.length === 0 && (
          <li className="py-3 text-[13px] text-muted">No tokens yet.</li>
        )}
        {tokens.map((token) => (
          <li key={token.id} className="flex flex-wrap items-center gap-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text">
                {token.name}
                {token.revoked_at && (
                  <span className="ml-2 rounded-[20px] border border-border bg-surface-2 px-[7px] py-[2px] text-[10px] font-normal text-muted">
                    revoked
                  </span>
                )}
              </p>
              <p className="font-mono text-xs text-muted">
                {token.token_prefix}… · created {formatWhen(token.created_at)} · last
                used {formatWhen(token.last_used_at)}
              </p>
            </div>
            {!token.revoked_at && (
              <button
                type="button"
                onClick={() => handleRevoke(token.id)}
                onBlur={() => setConfirmingId(null)}
                className="h-[30px] cursor-pointer rounded-[7px] border border-border px-3 text-[12px] font-semibold text-text hover:border-red-500 hover:text-red-500"
              >
                {confirmingId === token.id ? "Confirm revoke?" : "Revoke"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
