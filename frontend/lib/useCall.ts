"use client";

/**
 * The caller's side of a conversation with the agent.
 *
 *   mic ──▶ speech recognition ──▶ utterance ──▶ /ws/call ──▶ Resolvyn
 *   speaker ◀── sentence-by-sentence audio ◀── agent_sentence events ◀──┘
 *
 * Two ways to recognise speech:
 *   server  microphone audio is streamed (PCM16, 16 kHz) to the backend, which forwards it to Gnani's real-time
 *           STT (Indian-accent models, server-side VAD). Works in any browser.
 *   browser the browser's own SpeechRecogniser (Chrome / Edge) sends finished sentences as text.
 *
 * Latency tricks: each agent sentence is fetched as audio the moment it arrives and played back-to-back;
 * acknowledgements are pre-cached server-side. Barge-in: when the caller starts talking the agent's voice is
 * ducked immediately, and stopped as soon as what was said is recognised (the server cancels the turn).
 * An echo guard keeps the agent from "hearing" itself through the speakers.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { CustomerTicketView } from "@/features/types";
import { NGROK_SKIP, WS_BASE_URL, api, ttsUrl } from "@/lib/api";

export type CallStatus = "idle" | "connecting" | "live" | "ended";
export type AgentStatus = "listening" | "thinking" | "speaking";
export type SttMode = "server" | "browser" | "none";
export interface Line {
  id: string;
  who: "you" | "agent" | "human" | "side";
  text: string;
  turn?: number;
}

const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s]/g, " ").split(/\s+/).filter(Boolean);

function pickFemaleVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const want = lang === "hi" ? "hi" : "en";
  const pool = voices.filter((v) => v.lang.toLowerCase().startsWith(want));
  const female = /(female|zira|aria|jenny|heera|swara|neerja|samantha|susan|hazel|libby|sonia|natasha|google uk english female|priya|veena|kalpana|hemant)/i;
  return pool.find((v) => female.test(v.name)) ?? pool.find((v) => /india/i.test(v.name + v.lang)) ?? pool[0] ?? null;
}

/** AudioWorklet: mono float32 @ device rate → Int16 @ 16 kHz in 512-sample frames (what Gnani's stream expects). */
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.acc = 0; this.n = 0; this.ratio = sampleRate / 16000; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n++; this.pos++;
      if (this.pos >= this.ratio) {
        this.buf.push(this.acc / this.n); this.acc = 0; this.n = 0; this.pos -= this.ratio;
        if (this.buf.length === 512) {
          const out = new Int16Array(512);
          for (let k = 0; k < 512; k++) { const v = Math.max(-1, Math.min(1, this.buf[k])); out[k] = v < 0 ? v * 32768 : v * 32767; }
          this.port.postMessage(out.buffer, [out.buffer]);
          this.buf = [];
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm16", Pcm16);
`;

export function useCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("listening");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [ticket, setTicket] = useState<CustomerTicketView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [sttSupported, setSttSupported] = useState(true);
  const [serverStt, setServerStt] = useState(false);
  const [sttMode, setSttMode] = useState<SttMode>("none");
  const [ttsFallback, setTtsFallback] = useState(false);

  const ws = useRef<WebSocket | null>(null);
  const rec = useRef<any>(null);
  const mic = useRef<{ ctx: AudioContext; stream: MediaStream } | null>(null);
  const mode = useRef<"voice" | "chat">("voice");
  const lang = useRef<"en" | "hi">("en");
  const live = useRef(false);
  const mutedRef = useRef(false);
  const speaking = useRef(false);
  const gen = useRef(0);
  const queue = useRef<{ gen: number; text: string; audio: Promise<Blob | null> }[]>([]);
  const playing = useRef(false);
  const turnDone = useRef(true);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const duckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentAgent = useRef<string[]>([]);
  const interimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInterim = useRef("");
  const seq = useRef(0);

  useEffect(() => {
    setSttSupported(!!SR);
    api.get<{ stt?: { provider: string } }>("/system").then((s) => setServerStt(s.stt?.provider === "gnani")).catch(() => undefined);
  }, []);

  // ── audio playback ─────────────────────────────────────────────────────────
  const refreshStatus = useCallback(() => {
    if (!live.current) return;
    if (playing.current || queue.current.length) setAgentStatus("speaking");
    else setAgentStatus(turnDone.current ? "listening" : "thinking");
    speaking.current = playing.current || queue.current.length > 0;
  }, []);

  const speakFallback = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickFemaleVoice(lang.current);
      if (v) u.voice = v;
      u.lang = v?.lang ?? (lang.current === "hi" ? "hi-IN" : "en-IN");
      u.rate = 1.05;
      u.pitch = 1.1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    });
  }, []);

  const pump = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    while (queue.current.length) {
      const item = queue.current[0];
      if (item.gen !== gen.current) {
        queue.current.shift();
        continue;
      }
      refreshStatus();
      const blob = await item.audio;
      if (item.gen !== gen.current) {
        queue.current.shift();
        continue;
      }
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        audioEl.current = a;
        await new Promise<void>((resolve) => {
          a.onended = () => resolve();
          a.onerror = () => resolve();
          a.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
        audioEl.current = null;
      } else {
        setTtsFallback(true);
        await speakFallback(item.text);
      }
      queue.current.shift();
    }
    playing.current = false;
    refreshStatus();
  }, [refreshStatus, speakFallback]);

  const enqueueAudio = useCallback(
    (text: string, l: string) => {
      const audio = fetch(ttsUrl(text, l), { headers: NGROK_SKIP })
        .then((r) => (r.ok ? r.blob() : null))
        .catch(() => null);
      queue.current.push({ gen: gen.current, text, audio });
      pump();
    },
    [pump],
  );

  const stopAudio = useCallback(() => {
    gen.current += 1;
    queue.current = [];
    audioEl.current?.pause();
    audioEl.current = null;
    window.speechSynthesis?.cancel();
    playing.current = false;
    speaking.current = false;
  }, []);

  /** The caller started talking: lower the agent's voice right away, restore if it was a false alarm. */
  const duck = useCallback(() => {
    if (!speaking.current) return;
    if (audioEl.current) audioEl.current.volume = 0.25;
    if (duckTimer.current) clearTimeout(duckTimer.current);
    duckTimer.current = setTimeout(() => {
      if (audioEl.current) audioEl.current.volume = 1;
    }, 2500);
  }, []);

  // ── sending ────────────────────────────────────────────────────────────────
  const send = useCallback((obj: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(obj));
  }, []);

  const pushYou = useCallback((text: string) => {
    seq.current += 1;
    setLines((p) => [...p, { id: `y${seq.current}`, who: "you", text }]);
  }, []);

  const submitUtterance = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || !live.current) return;
      if (interimTimer.current) clearTimeout(interimTimer.current);
      lastInterim.current = "";
      setInterim("");
      turnDone.current = false;
      pushYou(t);
      send({ type: "utterance", text: t });
      setAgentStatus("thinking");
    },
    [pushYou, send],
  );

  const isEcho = useCallback((text: string) => {
    const words = norm(text);
    if (words.length === 0) return true;
    const agent = new Set(norm(recentAgent.current.slice(-3).join(" ")));
    const hit = words.filter((w) => agent.has(w)).length;
    return hit / words.length >= 0.6;
  }, []);

  const bargeIn = useCallback(() => {
    stopAudio();
    turnDone.current = true;
    setAgentStatus("listening");
    send({ type: "barge_in" });
  }, [send, stopAudio]);

  // ── browser speech recognition (fallback route) ────────────────────────────
  const startRecognition = useCallback(() => {
    if (!SR || mode.current !== "voice" || !live.current) return;
    try {
      const r = new SR();
      r.lang = lang.current === "hi" ? "hi-IN" : "en-IN";
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e: any) => {
        if (mutedRef.current) return;
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const text: string = res[0].transcript;
          if (res.isFinal) {
            if (!isEcho(text) || !speaking.current) submitUtterance(text);
            interimText = "";
          } else {
            interimText += text;
          }
        }
        if (!interimText) return;
        const words = norm(interimText).length;
        if (speaking.current) {
          if (words >= 2 && !isEcho(interimText)) bargeIn();
          else return;
        }
        setInterim(interimText);
        if (interimText !== lastInterim.current) {
          lastInterim.current = interimText;
          if (interimTimer.current) clearTimeout(interimTimer.current);
          interimTimer.current = setTimeout(() => {
            const t = lastInterim.current;
            if (t && norm(t).length >= 2 && !speaking.current) {
              try {
                r.abort();
              } catch {
                /* restarted by onend */
              }
              submitUtterance(t);
            }
          }, 700);
        }
      };
      r.onerror = (ev: any) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") setError("Microphone permission was denied. You can still chat by typing.");
      };
      r.onend = () => {
        if (live.current && mode.current === "voice") setTimeout(startRecognition, 120);
      };
      r.start();
      rec.current = r;
    } catch {
      /* start() throws if already started; onend will retry */
    }
  }, [bargeIn, isEcho, submitUtterance]);

  // ── server-side recognition: stream the microphone ─────────────────────────
  const startMicStream = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm16", { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (e) => {
      if (mutedRef.current || ws.current?.readyState !== WebSocket.OPEN) return;
      ws.current.send(e.data as ArrayBuffer);
    };
    src.connect(node);
    mic.current = { ctx, stream };
  }, []);

  const stopMic = useCallback(() => {
    mic.current?.stream.getTracks().forEach((t) => t.stop());
    mic.current?.ctx.close().catch(() => undefined);
    mic.current = null;
  }, []);

  // ── websocket events ───────────────────────────────────────────────────────
  const onEvent = useCallback(
    (ev: any) => {
      switch (ev.type) {
        case "session":
          setStatus("live");
          setSttMode(mode.current === "chat" ? "none" : ev.stt === "server" ? "server" : "browser");
          if (mode.current === "voice") {
            if (ev.stt === "server") {
              startMicStream().catch(() => setError("Could not open the microphone. You can still chat by typing."));
            } else {
              startRecognition();
            }
          }
          break;
        case "ticket":
          setTicket(ev.ticket);
          break;
        case "heard": {
          // server-side recognition produced a final utterance: it interrupts whatever the agent was saying
          stopAudio();
          turnDone.current = false;
          setInterim("");
          pushYou(ev.text);
          setAgentStatus("thinking");
          break;
        }
        case "user_speaking":
          duck();
          setInterim("…");
          break;
        case "stt_error":
          setError("The speech service had a hiccup. Keep talking, or type instead.");
          break;
        case "agent_sentence": {
          const text: string = ev.text;
          setLines((p) => {
            const who = ev.sender === "human" ? "human" : "agent";
            const last = p[p.length - 1];
            if (last && last.who === who && last.turn === ev.turn) {
              return [...p.slice(0, -1), { ...last, text: `${last.text} ${text}` }];
            }
            return [...p, { id: `a${ev.turn}-${p.length}`, who, text, turn: ev.turn }];
          });
          recentAgent.current.push(text);
          if (recentAgent.current.length > 8) recentAgent.current.shift();
          turnDone.current = false;
          if (mode.current === "voice") enqueueAudio(ev.say ?? text, ev.lang ?? lang.current);
          else setAgentStatus("thinking");
          break;
        }
        case "agent_done":
          turnDone.current = true;
          refreshStatus();
          break;
        case "agent_status":
          if (!speaking.current) setAgentStatus(ev.state === "thinking" ? "thinking" : "listening");
          break;
        case "side_talk":
          seq.current += 1;
          setLines((p) => [...p, { id: `s${seq.current}`, who: "side", text: ev.text }]);
          turnDone.current = true;
          setInterim("");
          setAgentStatus("listening");
          break;
        case "call_ended":
          break;
      }
    },
    [duck, enqueueAudio, pushYou, refreshStatus, startMicStream, startRecognition, stopAudio],
  );

  // ── public API ─────────────────────────────────────────────────────────────
  const start = useCallback(
    async (opts: { customerId?: string; mode: "voice" | "chat"; lang: "en" | "hi" }) => {
      setError(null);
      setLines([]);
      setTicket(null);
      setInterim("");
      mode.current = opts.mode;
      lang.current = opts.lang;
      mutedRef.current = false;
      setMuted(false);
      setStatus("connecting");

      if (opts.mode === "voice") {
        // Mobile browsers only allow audio that was "unlocked" inside a tap: play a silent clip now.
        try {
          const unlock = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgLsAAAB3AQACABAAZGF0YQAAAAA=");
          unlock.volume = 0;
          await unlock.play().catch(() => undefined);
        } catch {
          /* best effort */
        }
        if (!SR && !serverStt) {
          setError("Voice needs Chrome or Edge (or a Gnani key on the server). Switch to chat mode to type instead.");
          setStatus("idle");
          return;
        }
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          s.getTracks().forEach((t) => t.stop()); // permission only
        } catch {
          setError("Microphone permission is needed for a voice call. Allow it, or use chat mode.");
          setStatus("idle");
          return;
        }
        window.speechSynthesis?.getVoices(); // warm the voice list for the fallback
      }

      const q = new URLSearchParams({ channel: opts.mode === "voice" ? "Call" : "Text", lang: opts.lang });
      if (opts.customerId) q.set("customer_id", opts.customerId);
      if (opts.mode === "voice" && serverStt) q.set("stt", "server");
      const sock = new WebSocket(`${WS_BASE_URL}/ws/call?${q}`);
      ws.current = sock;
      sock.onopen = () => {
        live.current = true;
      };
      sock.onmessage = (m) => onEvent(JSON.parse(m.data));
      sock.onerror = () => setError("Could not reach the support service. Is the backend running?");
      sock.onclose = () => {
        if (live.current) {
          live.current = false;
          stopAudio();
          stopMic();
          try {
            rec.current?.abort();
          } catch {
            /* already stopped */
          }
          setStatus("ended");
        } else {
          setStatus((s) => (s === "connecting" ? "idle" : s));
        }
      };
    },
    [onEvent, serverStt, stopAudio, stopMic],
  );

  const sendText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (agentStatus === "speaking") bargeIn();
      submitUtterance(text);
    },
    [agentStatus, bargeIn, submitUtterance],
  );

  const end = useCallback(() => {
    send({ type: "end" });
    live.current = false;
    stopAudio();
    stopMic();
    try {
      rec.current?.abort();
    } catch {
      /* already stopped */
    }
    setStatus("ended");
    setTimeout(() => ws.current?.close(), 400);
  }, [send, stopAudio, stopMic]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current) {
      try {
        rec.current?.abort();
      } catch {
        /* noop */
      }
      setInterim("");
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setLines([]);
    setTicket(null);
    setError(null);
  }, []);

  useEffect(
    () => () => {
      live.current = false;
      ws.current?.close();
      stopAudio();
      stopMic();
      try {
        rec.current?.abort();
      } catch {
        /* noop */
      }
    },
    [stopAudio, stopMic],
  );

  return { status, agentStatus, lines, interim, ticket, error, muted, sttSupported: sttSupported || serverStt, serverStt, sttMode, ttsFallback, start, sendText, end, toggleMute, reset };
}
