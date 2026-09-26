"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { BenchmarkHighlights } from "@/components/benchmarks/BenchmarkHighlights";
import type { Results } from "@/components/benchmarks/BenchmarkView";
import { LogoMark } from "@/components/brand/Logo";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Button } from "@/components/ui/button";

/** The pitch and the proof: the hero, how it works, and a few measured numbers. The conversation itself lives at /talk. */
export default function HomePage() {
  const [results, setResults] = useState<Results | null>(null);
  useEffect(() => {
    fetch("/benchmarks.json").then((r) => (r.ok ? r.json() : null)).then(setResults).catch(() => undefined); // shipped with the site: needs no backend
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <HowItWorks />

      {results ? (
        <section id="benchmarks" className="scroll-mt-4 border-t bg-card/50">
          <div className="mx-auto max-w-[1240px] px-6 py-16">
            <BenchmarkHighlights r={results} />
          </div>
        </section>
      ) : null}

      <section className="border-t">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center gap-5 px-6 py-20 text-center">
          <h2 className="font-display text-3xl font-normal tracking-tight sm:text-5xl">See it resolve something.</h2>
          <p className="max-w-xl text-muted-foreground">Talk to Riya, chat with her, or send an email. She can look at orders and payments and sort most things out straight away.</p>
          <Button asChild size="lg" className="h-12 rounded-full px-8 text-[15px]">
            <Link href="/talk">Start a conversation</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row">
          <span className="flex items-center gap-2">
            <LogoMark size={20} />
            <span className="font-display text-sm text-foreground">Resolvyn</span>
            <span>Every answer is verified before it is said.</span>
          </span>
          <span>Nova Retail is a demo business. All customer, order and payment data is simulated.</span>
        </div>
      </footer>
    </div>
  );
}
