"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import type { Results } from "@/components/benchmarks/BenchmarkView";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The home page's proof: a handful of plain-language numbers, nothing else. The detail lives in the team console. */
export function BenchmarkHighlights({ r }: { r: Results }) {
  const pm = r.truth?.per_mode ?? {};
  const gated = ["guarded", "stress_guarded"].map((k) => pm[k]).filter(Boolean);
  const probes = gated.reduce((n: number, x: any) => n + x.probes, 0);
  const bad = gated.reduce((n: number, x: any) => n + x.violations, 0);
  const jm = r.jev_model, ho = r.offline?.jev?.heldout, res = r.resolution, lrn = r.learning, em = r.email;
  const firstSound = r.latency?.first_sound_ms?.p50; // what the caller hears first: the spoken acknowledgement
  const firstWord = r.latency?.first_word_ms?.p50;

  const tiles: { value: string; label: string; sub: string }[] = [
    probes ? { value: pct(1 - bad / probes), label: "of replies stayed truthful", sub: `Even when ${probes} conversations were built to make it invent a date, a price or a promise.` } : null,
    res ? { value: `${res.passed} of ${res.n}`, label: "everyday support cases solved start to finish", sub: "Refunds, unlocks, cancellations, delays, angry callers, Hindi. Money only moves after a manager approves." } : null,
    firstSound && firstWord ? { value: `${(firstSound / 1000).toFixed(2)} s`, label: "until Riya responds out loud", sub: `A spoken acknowledgement comes first; the full answer follows in about ${(firstWord / 1000).toFixed(1)} s, on a laptop.` } : null,
    lrn ? { value: `${Math.round(lrn.second_caller_from_memory * lrn.n)} of ${lrn.n}`, label: "new problems learned from a single tip", sub: "A manager types one fix. The live caller hears it, and the next customer gets it automatically." } : null,
    jm ? { value: pct(jm.with_model_help), label: "sent to the right team first time", sub: "Measured on sentences it had never seen before." } : null,
    ho?.human_request ? { value: pct(ho.human_request.recall), label: "of “let me talk to a person” requests recognised", sub: "With no false alarms, so people are only pulled in when they are needed." } : null,
    em ? { value: pct(em.grounding_rate), label: "of amounts and IDs in follow-up emails match the records", sub: "Every call or chat ends with a short, accurate summary." } : null,
    { value: "$0", label: "per minute for the AI", sub: "The language model runs on a 4 GB laptop GPU. No cloud AI bill." },
  ].filter(Boolean) as { value: string; label: string; sub: string }[];

  return (
    <div>
      <div className="max-w-2xl">
        <p className="text-sm font-medium text-success">By the numbers</p>
        <h2 className="mt-3 font-display text-3xl font-normal tracking-tight sm:text-5xl">Measured, not promised.</h2>
        <p className="mt-3 text-muted-foreground">Real conversations against the running system, on one laptop, judged by what actually happened.</p>
      </div>

      <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="border-t pt-5">
            <p className="font-display text-5xl font-normal leading-none tracking-tight text-foreground tabular-nums">{t.value}</p>
            <p className="mt-3 text-[15px] font-medium leading-snug text-foreground">{t.label}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs text-muted-foreground">
        <span>Small test samples on simulated Nova Retail data: read them as this build&apos;s measurements, not industry statistics.</span>
        <Link href="/ops/benchmarks" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
          Full results and method <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
