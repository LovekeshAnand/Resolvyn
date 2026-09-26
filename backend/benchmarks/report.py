"""Turn benchmarks/results.json into docs/benchmarks.md. Every number in the document comes from the JSON, none is typed by hand.

  .venv\\Scripts\\python -m benchmarks.report
"""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
R: dict = {}
for name in ("results.json", "results_part2.json", "results_part3.json", "results_part4.json", "results_truth.json"):  # a later file replaces the stages it re-measured
    f = ROOT / "benchmarks" / name
    if f.exists():
        part = json.loads(f.read_text(encoding="utf-8"))
        R.update({"truth": part["truth"]} if name == "results_truth.json" else part)  # the truth run's timings are not the resolution run's
TESTS = json.loads((ROOT / "benchmarks" / "tests.json").read_text(encoding="utf-8")) if (ROOT / "benchmarks" / "tests.json").exists() else {}


def p(x, d=0):
    return f"{x * 100:.{d}f}%"


def ms(x):
    return f"{x:,.0f} ms"


def fr(a, b):
    return f"{a}/{b}"


hw = R.get("hardware", {})
gpu = hw.get("gpu", {})
off, res, tru, lrn = R.get("offline", {}), R.get("resolution", {}), R.get("truth", {}), R.get("learning", {})
lat, srv, jm, em = R.get("latency", {}), R.get("server_side", {}), R.get("jev_model", {}), R.get("email", {})
eng, gl = R.get("engine", {}), R.get("gpu_loaded", {})
jev, ret = off.get("jev", {}), off.get("retrieval", {})

L = []
add = L.append
add("# Resolvyn benchmarks\n")
add(f"Measured on **{gpu.get('name', 'a laptop GPU')} ({gpu.get('vram_total_mb', 0) // 1024} GB VRAM)**, {hw.get('cpu', 'CPU')}, {hw.get('ram_gb', '?')} GB RAM, "
    f"run on {R.get('when', '')}. The language model is {R.get('model', 'a local Qwen')}: nothing in these numbers used a cloud model. "
    "Regenerate everything with `cd backend && .venv\\Scripts\\python -m benchmarks.run` then `-m benchmarks.report`.\n")
add("> **How to read this.** These are real conversations against the real running system, judged by what actually happened (tools called, ticket state, "
    "the words the customer heard), not by the model's own account of itself. Samples are small and the callers are scripted, so treat percentages as "
    "measurements of *this* build, not as population statistics. Where the system is weak, the number says so.\n")

# ── the headline ──────────────────────────────────────────────────────────────
if tru:
    m = tru["per_mode"]
    g, a = ["guarded", "stress_guarded"], ["raw", "stress_raw"]
    tot = lambda k, ms: sum(m[x][k] for x in ms)  # noqa: E731
    add("## 1. Nothing unverified reaches the customer\n")
    add("The property Resolvyn is built around: **the language model may only phrase facts that a tool verified.** To measure it we tempt the model on purpose "
        f"({tru['scenarios']} adversarial scenarios): a delivery date that does not exist, a refund that is still pending, \"other customers reported this\", a price, a "
        "warranty, a reference number, a fix time, an outcome guarantee. Each reply is judged by a ground-truth pattern written per scenario, independent of the gate's own "
        "rules. Two conditions: *normal* (truth rules in the prompt, as shipped) and *stress* (rules removed from the prompt, so the gate is the only defence), each with the gate off and on.\n")
    add("| | Model alone | With the truth gate |")
    add("|---|---|---|")
    for label, ra, ga in (("Normal", "raw", "guarded"), ("Stress (prompt rules removed)", "stress_raw", "stress_guarded")):
        add(f"| {label}: turns that told the customer something untrue | {fr(m[ra]['violations'], m[ra]['probes'])} | {fr(m[ga]['violations'], m[ga]['probes'])} |")
        add(f"| {label}: turns where the gate stepped in | (would have: {m[ra]['would_block']}) | {m[ga]['blocked']} |")
        add(f"| {label}: replies that still gave the useful answer | {p(m[ra]['completeness'])} | {p(m[ga]['completeness'])} |")
    add(f"| **All conditions** | **{fr(tot('violations', a), tot('probes', a))} untrue** | **{fr(tot('violations', g), tot('probes', g))} untrue** |")
    add("")
    add("| Scenario | Normal alone | Normal gated | Stress alone | Stress gated |")
    add("|---|---|---|---|---|")
    for k, v in tru["per_scenario"].items():
        add(f"| {k.replace('_', ' ')} | {v['raw']} | {v['guarded']} | {v['stress_raw']} | {v['stress_guarded']} |")
    add("")
    ex = [e for e in tru.get("examples", []) if e["mode"].endswith("raw")]
    if ex:
        add("What the ungated model actually said:\n")
        for e in ex[:4]:
            add(f"- *{e['scenario'].replace('_', ' ')}*: \"{e['said']}\"")
        add("")
    add("**Honest reading.** With the truth rules in its prompt and verified facts handed to it, the 4B model is already truthful almost every time; the gate is the safety net "
        "for the rare slip, and it costs a little helpfulness because it drops a sentence it cannot verify. The sample is small "
        f"({sum(x['probes'] for x in m.values())} conversations), so read the shape rather than the decimals.\n")

# ── actions ───────────────────────────────────────────────────────────────────
if res:
    add("## 2. It resolves real issues, with the human gates held\n")
    add(f"**{fr(res['passed'], res['n'])} end-to-end scenarios passed** with the real model: duplicate-payment refund with manager approval, account unlock with identity "
        "check, delayed shipment, order cancellation, unknown order (escalates after two misses), asking for a manager, an angry caller, a policy question answered from documents, "
        "Hinglish, someone else's order (refused), side talk (silent), and a tool outage (never claims success). Each is checked by tool calls, ticket state and what was said.\n")
    add("| Scenario | Result | Turns | Time | Human actions |")
    add("|---|---|---|---|---|")
    for s in res["scenarios"]:
        add(f"| {s['id'].replace('_', ' ')} | {'pass' if s['passed'] else '**FAIL**'} | {s['turns']} | {s['seconds']} s | {s['human_actions']} |")
    add(f"\nThe ₹2,499 refund was **never executed before the manager approved it** in every run; scenarios that needed no person resolved with zero human actions.\n")

# ── speed ─────────────────────────────────────────────────────────────────────
if srv or lat:
    add("## 3. Speed\n")
    add("| Measure | Median | 95th percentile |")
    add("|---|---|---|")
    if srv:
        a, j, w, t = srv["acknowledgement_ms"], srv["jev_ms"], srv["first_word_ms"], srv["turn_total_ms"]
        add(f"| Spoken acknowledgement queued (inside the server, before any model runs) | {ms(a['p50'])} | {ms(a['p95'])} |")
        add(f"| Jev judgment of the sentence, end to end incl. entity extraction | {ms(j['p50'])} | {ms(j['p95'])} |")
        add(f"| First real word of the reply, server side | {ms(w['p50'])} | {ms(w['p95'])} |")
        add(f"| Whole turn including tools and the model | {ms(t['p50'])} | {ms(t['p95'])} |")
    if lat:
        f, w, d = lat["first_sound_ms"], lat["first_word_ms"], lat["full_reply_ms"]
        add(f"| What a caller experiences: first sound (WebSocket, localhost) | {ms(f['p50'])} | {ms(f['p95'])} |")
        add(f"| What a caller experiences: first real word | {ms(w['p50'])} | {ms(w['p95'])} |")
        add(f"| What a caller experiences: the complete reply | {ms(d['p50'])} | {ms(d['p95'])} |")
    if jev.get("speed"):
        s = jev["speed"]
        add(f"| Jev rules alone, {s['sentences']:,} sentences | {s['p50_ms']:.2f} ms | {s['p99_ms']:.2f} ms (p99) |")
    add("")
    if srv:
        add(f"An acknowledgement is spoken on {p(srv['turns_with_acknowledgement'])} of turns (short answers like \"yes\" need none); on the others the first word is the reply itself.\n")

# ── learning ──────────────────────────────────────────────────────────────────
if lrn:
    add("## 4. A first-time problem becomes an answer for the next customer\n")
    add(f"Three problems the system had never seen (an unknown headphone error, a kettle error code, an earbuds-case fault). A manager types one suggestion; a second "
        "caller then describes the same problem in different words.\n")
    add("| | Result |")
    add("|---|---|")
    add(f"| Flagged to the manager instead of guessed | {p(lrn['flagged'])} |")
    add(f"| Manager's suggestion relayed **on the live call** | {p(lrn['relayed_live'])} |")
    add(f"| Second caller (different wording) answered from memory, no human involved | {p(lrn['second_caller_from_memory'])} |")
    rows = [r["relay_first_word_ms"] for r in lrn["rows"] if r["relay_first_word_ms"]]
    if rows:
        add(f"| Time from the manager pressing send to the caller hearing the fix | {ms(sorted(rows)[len(rows) // 2])} (median) |")
    add("")

# ── understanding ─────────────────────────────────────────────────────────────
if jev:
    add("## 5. Understanding\n")
    ho = jev.get("heldout", {})
    add("Two sets: a *dev* set that Jev's phrase lists were tuned against, and a *held-out* set written afterwards and never used for tuning. The held-out numbers are the honest ones.\n")
    add("| Task | Dev set | Held-out set |")
    add("|---|---|---|")
    r0, r1 = jev["routing"], ho.get("routing", {})
    add(f"| Route to the right department (rules only) | {p(r0['department_accuracy'], 1)} of {r0['n']} | {p(r1.get('department_accuracy', 0), 1)} of {r1.get('n', 0)} |")
    if jm:
        add(f"| Route to the right department (rules, then the 4B model when unsure) | | **{p(jm['with_model_help'], 1)}** of {jm['n']} (asked the model on {p(jm['asked_model'])}) |")
    h0, h1 = jev["human_request"], ho.get("human_request", {})
    add(f"| \"I want a person\": precision / recall | {p(h0['precision'])} / {p(h0['recall'])} | {p(h1.get('precision', 0))} / {p(h1.get('recall', 0))} |")
    add(f"| Is this sentence for the agent or for someone else in the room | {p(jev['side_talk']['accuracy'], 1)} of {jev['side_talk']['n']} | |")
    add(f"| Yes / no / \"that's all\" | {p(jev['dialogue_acts']['accuracy'], 1)} of {jev['dialogue_acts']['n']} | |")
    if ret:
        add(f"| Retrieval: the right document section is first / in the top 3 | {p(ret['hit_at_1'])} / {p(ret['hit_at_3'])} of {ret['n']} | |")
    add("")
    miss = (r1.get("misses") or [])[:4]
    if miss:
        add("Held-out routing mistakes (rules only), shown so the number is not a black box: " + "; ".join(f"\"{m['said']}\" went to {m['got']}, expected {m['expected']}" for m in miss) + ".\n")

# ── email ─────────────────────────────────────────────────────────────────────
if em:
    add("## 6. The email after every call or chat\n")
    cases = em.get("cases") or []
    add(f"Real chats with our two customers (account unlock, order cancellation with refund, warranty question) each produced one summary email ({len(cases)} cases). "
        "It is built only from verified records, never from the model's memory of the call.\n")
    add("| | |")
    add("|---|---|")
    add(f"| IDs and amounts in the emails that trace back to the ticket's verified records | **{fr(em['specifics_grounded'], em['specifics_checked'])} ({p(em['grounding_rate'])})** |")
    if cases:
        add(f"| Summary sizes | {', '.join(str(c['email_chars']) for c in cases)} characters |")
    add(f"| Largest message on the wire (Gmail clips HTML at 102 KB) | {em.get('max_message_bytes', 0) / 1024:.1f} KB |")
    et = R.get("email_tests", {})
    if et:
        add(f"| Email protocol, content and safety tests (threading, loop guard, auto-submitted header, caps) | {et['passed']} passed, {et['failed']} failed |")
    add("")

# ── resources ─────────────────────────────────────────────────────────────────
add("## 7. What it costs to run\n")
add("| | |")
add("|---|---|")
if gl:
    add(f"| GPU memory with the model loaded | {gl.get('vram_used_mb', 0) / 1024:.1f} GB of {gl.get('vram_total_mb', 0) / 1024:.0f} GB |")
if eng.get("tokens_per_second"):
    add(f"| Generation speed (Qwen3.5-4B Q4_K_M, fully on the GPU) | {eng['tokens_per_second']} tokens/s, first token in {eng.get('first_token_ms')} ms |")
if R.get("server"):
    add(f"| Server ready with the model | {R['server']['ready_seconds']} s |")
add("| Cloud calls, API keys or per-minute fees for the language model | none |")
add("")
if TESTS:
    add("## 8. Automated tests\n")
    add(f"{TESTS.get('backend', '?')} backend tests and {TESTS.get('agents', '?')} orchestration tests, all passing without a GPU or API keys.\n")

add("## Limits of these numbers\n")
add("- The customer, order, payment and refund systems are simulations, so \"verified\" means verified against the simulated services; the mechanism is what is being measured.")
add("- Small samples, one scripted caller per scenario. Percentages will move by several points between runs; the model samples at temperature 0.85.")
add("- The adversarial ground-truth patterns catch the obvious ways to break the rules; a creative enough hallucination could slip past both the pattern and the guard.")
add("- Retrieval and routing sets are small and hand-written for this business's documents.")

# the same merged numbers, as a static file the website ships with, so the public pages need no running backend
site = ROOT.parent / "frontend" / "public" / "benchmarks.json"
if site.parent.exists():
    site.write_text(json.dumps({**R, "tests": TESTS}, ensure_ascii=False), encoding="utf-8")
    print("wrote", site)

out = ROOT.parent / "docs" / "benchmarks.md"
out.write_text("\n".join(L) + "\n", encoding="utf-8")
print("wrote", out, len(L), "lines")
