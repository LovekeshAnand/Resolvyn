"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { WS_BASE_URL } from "@/lib/api";

/**
 * Realtime layer — docs/architecture.md §3 (WebSocket preferred, short
 * polling fallback). One shared connection per tab: on any broadcast from
 * the backend (app/realtime.py), Next.js server components are asked to
 * re-fetch (router.refresh()) so every page reflects live state without a
 * manual reload, and a rolling notification list is kept for the bell.
 */

const WS_URL = `${WS_BASE_URL}/ws`;

export interface RealtimeEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

const NOTIFIABLE_TYPES = new Set([
  "ticket_updated",
  "human_action_created",
  "learning_signal_created",
]);

interface RealtimeState {
  connected: boolean;
  notifications: RealtimeEvent[];
  unreadCount: number;
  markAllRead: () => void;
}

const RealtimeContext = createContext<RealtimeState>({
  connected: false,
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState<RealtimeEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  }, [router]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      try {
        socket = new WebSocket(WS_URL);
      } catch {
        return;
      }
      socket.onopen = () => !cancelled && setConnected(true);
      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        retryTimer = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket?.close();
      socket.onmessage = (raw) => {
        try {
          const event = JSON.parse(raw.data) as RealtimeEvent;
          scheduleRefresh();
          if (NOTIFIABLE_TYPES.has(event.type)) {
            setNotifications((prev) => [event, ...prev].slice(0, 20));
            setUnreadCount((n) => n + 1);
          }
        } catch {
          // ignore malformed frames
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [scheduleRefresh]);

  return (
    <RealtimeContext.Provider
      value={{ connected, notifications, unreadCount, markAllRead: () => setUnreadCount(0) }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
