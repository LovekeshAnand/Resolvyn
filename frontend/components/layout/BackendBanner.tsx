"use client";

import { PlugZap } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IS_REMOTE, NGROK_SKIP, ORIGIN, setBackend } from "@/lib/api";

/** Shown only while the backend cannot be reached. On a hosted site the backend is a laptop behind an ngrok address that changes
 *  between runs, so the address can be pasted here (or arrive as ?api=... in the link the start script prints). */
export function BackendBanner() {
  const [down, setDown] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch(`${ORIGIN}/health`, { headers: NGROK_SKIP, cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (alive) setDown(!r.ok);
      } catch {
        if (alive) setDown(true);
      }
    };
    check();
    const t = setInterval(check, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!down) return null;
  return (
    <div role="alert" className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-xl rounded-xl border bg-card p-4 shadow-float">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-background text-warning">
          <PlugZap className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">The Resolvyn backend is not reachable</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Looking for {IS_REMOTE ? ORIGIN : "this site's own backend"}. Start it on the laptop (<code className="rounded bg-muted px-1">.\start-public.ps1</code>) and paste the address it prints.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) setBackend(url);
            }}
          >
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-name.ngrok-free.app" className="h-9 text-sm" aria-label="Backend address" />
            <Button type="submit" size="sm" disabled={!url.trim()}>
              Connect
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
