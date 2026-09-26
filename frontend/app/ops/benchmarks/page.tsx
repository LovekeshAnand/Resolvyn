"use client";

import { useEffect, useState } from "react";

import { BenchmarkView, type Results } from "@/components/benchmarks/BenchmarkView";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";

export default function BenchmarksPage() {
  const [results, setResults] = useState<Results | null | "none">(null);

  useEffect(() => {
    fetch("/benchmarks.json").then((r) => (r.ok ? r.json() : Promise.reject())).then(setResults).catch(() => setResults("none"));
  }, []);

  return (
    <AppShell title="Benchmarks">
      {results === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : results === "none" ? (
        <EmptyState title="No benchmark results yet" description="Run python -m benchmarks.run in the backend folder to measure this build." />
      ) : (
        <BenchmarkView r={results} />
      )}
    </AppShell>
  );
}
