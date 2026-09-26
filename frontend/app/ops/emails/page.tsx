"use client";

import { Mail, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { API_BASE_URL, api } from "@/lib/api";
import { fmtClock } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mail_ = {
  to: string;
  subject: string;
  body: string;
  html: string | null;
  ticket_id: string;
  sent_at: string;
  delivered: string;
  kind: string;
  intended_for: string | null;
};
type Status = { inbox: string | null; smtp: boolean; sent: number; address: string; redirect_to: string | null; summaries: boolean };

const KIND: Record<string, { label: string; variant: "info" | "success" | "muted" }> = {
  summary: { label: "Summary", variant: "success" },
  reply: { label: "Reply", variant: "info" },
  test: { label: "Test", variant: "muted" },
};

/** Every email Riya sends: replies in email threads, the summary after each call or chat, and test messages. */
export default function EmailsPage() {
  const [mails, setMails] = useState<Mail_[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [selected, setSelected] = useState(0);
  const [to, setTo] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api.get<Mail_[]>("/email/outbox").then(setMails).catch(() => undefined);
    api.get<Status>("/email/status").then(setStatus).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const sendTest = async () => {
    setNote(null);
    try {
      const r = await api.post<{ to: string; delivered: string }>("/email/test", { to });
      setNote({ ok: true, text: `Sent to ${r.to} (${r.delivered}).` });
      load();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Could not send" });
    }
  };

  const mail = mails[Math.min(selected, mails.length - 1)];
  return (
    <AppShell title="Emails">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <div className="grid gap-5 md:grid-cols-[1fr_auto]">
          <Card title="Mail delivery" subtitle="Where Riya's emails go">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={status?.smtp ? "success" : "muted"}>{status?.smtp ? "Real mail server connected" : "Simulated inbox (nothing leaves this machine)"}</Badge>
              {status?.inbox && <Badge variant="info">Watching {status.inbox}</Badge>}
              {status?.redirect_to && <Badge variant="warning">All mail redirected to {status.redirect_to}</Badge>}
              <Badge variant={status?.summaries ? "success" : "muted"}>Call and chat summaries {status?.summaries ? "on" : "off"}</Badge>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              To send real email, set EMAIL_ADDRESS, EMAIL_PASSWORD (a Gmail app password), EMAIL_SMTP_HOST and EMAIL_IMAP_HOST in backend/.env. To receive every email at one inbox while testing, set EMAIL_REDIRECT_TO.
            </p>
            <div className="mt-4 flex max-w-md items-center gap-2">
              <Input placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Send a test email to" />
              <Button onClick={sendTest} disabled={!to.includes("@")}>
                <Send /> Send test
              </Button>
            </div>
            {note && (
              <p role="status" className={cn("mt-2 text-xs", note.ok ? "text-success" : "text-danger")}>
                {note.text}
              </p>
            )}
          </Card>
        </div>

        {mails.length === 0 ? (
          <EmptyState title="No emails yet" description="Finish a call or chat and the customer's summary appears here, or send an email from the customer side." />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
            <Card bodyClass="p-0" className="max-h-[720px] overflow-y-auto">
              {mails.map((m, i) => (
                <button key={m.sent_at + i} onClick={() => setSelected(i)} className={cn("flex w-full flex-col gap-1 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/50", i === Math.min(selected, mails.length - 1) && "bg-muted/60")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{m.subject}</span>
                    <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtClock(m.sent_at)}</time>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={KIND[m.kind]?.variant ?? "muted"}>{KIND[m.kind]?.label ?? m.kind}</Badge>
                    <span className="truncate">to {m.to}</span>
                  </span>
                </button>
              ))}
            </Card>
            {mail && (
              <Card bodyClass="p-0" className="overflow-hidden">
                <div className="space-y-1 border-b px-5 py-3.5">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Mail className="h-4 w-4" /> {mail.subject}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    To {mail.to}
                    {mail.intended_for ? ` (customer: ${mail.intended_for})` : ""} · {mail.ticket_id} · {mail.delivered} ·{" "}
                    <a href={`${API_BASE_URL}/email/eml/${Math.min(selected, mails.length - 1)}`} className="underline underline-offset-2 hover:text-foreground">
                      Download .eml
                    </a>
                  </p>
                </div>
                {mail.html ? (
                  <iframe title="Email preview" sandbox="" srcDoc={mail.html.replace("cid:resolvyn-logo@resolvyn", "/resolvyn-logo.png")} className="h-[640px] w-full bg-white" />
                ) : (
                  <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap p-5 text-[13px] leading-relaxed">{mail.body}</pre>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
