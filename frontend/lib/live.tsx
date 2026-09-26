"use client";

/**
 * Team-side live store (docs/architecture.md §2.4: "ticket status updated in real
 * time by the team"; project.md §45). One WebSocket to /ws/ops carries every
 * ticket update, event, tool call, approval request and first-time-bug alert.
 * Components render this state; they never decide it (docs/claude.md).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  AgentEvent,
  AgentInfo,
  FirstTimeBug,
  LlmStatus,
  PendingAction,
  Stats,
  Ticket,
} from "@/features/types";
import { API_BASE_URL, NGROK_SKIP, WS_BASE_URL, api } from "@/lib/api";

export type LiveEvent = { type: string; [key: string]: any };

export interface Toast {
  id: number;
  kind: "bug" | "approval" | "info";
  title: string;
  body: string;
  href?: string;
}

interface LiveState {
  connected: boolean;
  tickets: Record<string, Ticket>;
  agents: AgentInfo[];
  stats: Stats | null;
  events: AgentEvent[];
  bugs: FirstTimeBug[];
  approvals: PendingAction[];
  llm: LlmStatus | null;
  demo: { state: string; scenario?: string } | null;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  subscribe: (fn: (e: LiveEvent) => void) => () => void;
  refreshBugs: () => Promise<void>;
}

const Ctx = createContext<LiveState | null>(null);

// Outside <LiveProvider> (pages that are not under /ops) the hook returns an inert, empty state instead of throwing.
const EMPTY: LiveState = {
  connected: false, tickets: {}, agents: [], stats: null, events: [], bugs: [], approvals: [], llm: null, demo: null, toasts: [],
  dismissToast: () => undefined, subscribe: () => () => undefined, refreshBugs: async () => undefined,
};

export function useLive(): LiveState {
  return useContext(Ctx) ?? EMPTY;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [tickets, setTickets] = useState<Record<string, Ticket>>({});
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [bugs, setBugs] = useState<FirstTimeBug[]>([]);
  const [approvals, setApprovals] = useState<PendingAction[]>([]);
  const [llm, setLlm] = useState<LlmStatus | null>(null);
  const [demo, setDemo] = useState<{ state: string; scenario?: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const subs = useRef(new Set<(e: LiveEvent) => void>());
  const toastId = useRef(1);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 12000);
  }, []);

  const subscribe = useCallback((fn: (e: LiveEvent) => void) => {
    subs.current.add(fn);
    return () => {
      subs.current.delete(fn);
    };
  }, []);

  const refreshBugs = useCallback(async () => {
    try {
      const all = await api.get<FirstTimeBug[]>("/human-intelligence/bugs");
      setBugs(all.filter((b) => b.status === "OPEN"));
    } catch {
      /* the socket will resync */
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(`${WS_BASE_URL}/ws/ops`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1800);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (msg) => {
        const e: LiveEvent = JSON.parse(msg.data);
        switch (e.type) {
          case "snapshot": {
            const map: Record<string, Ticket> = {};
            for (const t of e.tickets as Ticket[]) map[t.ticket_id] = t;
            setTickets(map);
            setAgents(e.agents);
            setStats(e.stats);
            setBugs(e.bugs);
            setApprovals(e.approvals);
            setEvents(e.events);
            break;
          }
          case "ticket_update":
            setTickets((prev) => ({ ...prev, [e.ticket.ticket_id]: { ...prev[e.ticket.ticket_id], ...e.ticket } }));
            break;
          case "summary":
            setTickets((prev) => {
              const t = prev[e.ticket_id];
              if (!t) return prev;
              return {
                ...prev,
                [e.ticket_id]: {
                  ...t,
                  ...(e.one_line_summary !== undefined && { one_line_summary: e.one_line_summary }),
                  ...(e.detailed_summary !== undefined && { detailed_summary: e.detailed_summary }),
                  ...(e.deep_summary !== undefined && { deep_summary: e.deep_summary }),
                  ...(e.next_step !== undefined && { next_step: e.next_step }),
                },
              };
            });
            break;
          case "event":
            setEvents((prev) => [e.event, ...prev].slice(0, 400));
            break;
          case "agent_update":
            setAgents((prev) => prev.map((a) => (a.name === e.agent.name ? { ...a, ...e.agent } : a)));
            break;
          case "stats":
            setStats(e.stats);
            setAgents(e.agents);
            setLlm(e.llm);
            break;
          case "bug_alert":
            setBugs((prev) => (prev.some((b) => b.bug_id === e.bug.bug_id) ? prev : [e.bug, ...prev]));
            pushToast({
              kind: "bug",
              title: "First-time bug reported",
              body: `${e.ticket.ticket_id} — ${e.bug.title}`,
              href: `/ops/tickets/${e.ticket.ticket_id}`,
            });
            break;
          case "bug_update":
            setBugs((prev) => prev.filter((b) => b.bug_id !== e.bug.bug_id || e.bug.status === "OPEN"));
            break;
          case "approval_request":
            setApprovals((prev) => (prev.some((a) => a.action_id === e.action.action_id) ? prev : [e.action, ...prev]));
            pushToast({
              kind: "approval",
              title: "Human approval required",
              body: `${e.ticket_id} — ${e.action.summary}`,
              href: `/ops/tickets/${e.ticket_id}`,
            });
            break;
          case "approval_decided":
            setApprovals((prev) => prev.filter((a) => a.action_id !== e.action.action_id));
            break;
          case "demo":
            setDemo({ state: e.state, scenario: e.scenario });
            break;
          case "reset":
            setTickets({});
            setEvents([]);
            setBugs([]);
            setApprovals([]);
            break;
        }
        subs.current.forEach((fn) => fn(e));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [pushToast]);

  // A reset wipes tickets server-side; make sure the snapshot is authoritative again.
  useEffect(() => {
    if (!demo || demo.state !== "finished") return;
    fetch(`${API_BASE_URL}/tickets`, { headers: NGROK_SKIP }).catch(() => undefined);
  }, [demo]);

  const value = useMemo<LiveState>(
    () => ({
      connected,
      tickets,
      agents,
      stats,
      events,
      bugs,
      approvals,
      llm,
      demo,
      toasts,
      dismissToast: (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
      subscribe,
      refreshBugs,
    }),
    [connected, tickets, agents, stats, events, bugs, approvals, llm, demo, toasts, subscribe, refreshBugs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
