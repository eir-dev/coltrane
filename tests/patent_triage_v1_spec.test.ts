// SPEC — patent-triage v1 upgrade, defined by its acceptance tests.
//
// Plan: docs/patent-triage-v1-upgrade.md. This file IS the contract: each it() is a
// structural acceptance criterion that FAILS until the genome is authored to meet it (RED —
// "contract defined, code missing"), and each open() is a design fork still to resolve (OPEN —
// "contract not grounded yet"). PR #173 review folded most forks into RED contracts; what
// remains OPEN is genuinely behavioral-pending-impl (the must-fire gate tests, grounded in
// tests/patent_triage_v1_gates.test.ts once the standard's I/O shape exists). RED by design;
// a slice is done when its describe() block goes green. Nothing imports not-yet-existing code —
// contracts read the genome off disk, so the file always collects cleanly.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "./_support/open.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const readJson = (p: string): Record<string, unknown> | null =>
  existsSync(join(REPO, p)) ? (JSON.parse(readFileSync(join(REPO, p), "utf8")) as Record<string, unknown>) : null;
const agent = (slug: string) => readJson(`agents/${slug}.json`);
const standard = (slug: string) => readJson(`standards/${slug}.json`);
const domainType = (slug: string) => readJson(`domain_types/${slug}.json`);
const skillMeta = (slug: string) => readJson(`skills/${slug}/meta.json`);
const skillPkg = (slug: string) => existsSync(join(REPO, "skills", slug, "meta.json"));
const props = (t: Record<string, unknown> | null): Record<string, unknown> =>
  ((t?.["schema"] as { properties?: Record<string, unknown> })?.properties) ?? {};

const METHOD_STUB = /^Carry out the .+ role:/i; // the migration-stub shape the floor retires

// (slug, required primitives, the 2-role Belbin disposition) — from the plan's roster table.
const ROSTER: Array<[string, string[], [string, string]]> = [
  ["disclosure-analyst", ["SENSE", "INTERPRET"], ["explorer", "analyst"]],
  ["claim-architect", ["INTERPRET", "PLAN"], ["planner", "analyst"]],
  ["prior-art-scout", ["SENSE", "JUDGE"], ["explorer", "critic"]],
  ["anticipation-mapper", ["INTERPRET", "JUDGE"], ["analyst", "critic"]],
  ["patent-examiner", ["JUDGE", "VERIFY"], ["critic", "executor"]],
  ["claim-amender", ["INTERPRET", "PLAN"], ["planner", "executor"]],
  ["triage-judge", ["JUDGE", "VERIFY"], ["critic", "synthesizer"]],
  ["spec-drafter", ["PLAN", "CREATE"], ["executor", "planner"]],
];

// ── Slice 0 — roster + standard shape ────────────────────────────────────────────
describe("patent-triage v1 · Slice 0 — roster + standard shape", () => {
  it("the patent-triage-v1 standard exists", () => {
    expect(standard("patent-triage-v1")).toBeTruthy();
  });
  it("its phases are analyze → claim → search → map → examine → amend → judge", () => {
    const phases = ((standard("patent-triage-v1")?.["phases"] as Array<{ name: string }>) ?? []).map((p) => p.name);
    expect(phases.slice(0, 7)).toEqual(["analyze", "claim", "search", "map", "examine", "amend", "judge"]);
  });

  for (const [slug, prims, dispo] of ROSTER) {
    describe(`agent ${slug}`, () => {
      it("exists", () => expect(agent(slug), `agents/${slug}.json missing`).toBeTruthy());
      it(`declares primitives ${prims.join("+")}`, () => {
        expect(((agent(slug)?.["primitives"] as string[]) ?? []).sort()).toEqual([...prims].sort());
      });
      it("carries exactly two Belbin roles", () => {
        expect(((agent(slug)?.["behavioral_primitives"] as string[]) ?? []).length).toBe(2);
        void dispo;
      });
      it("has an authored method (not the migration stub)", () => {
        const m = String(agent(slug)?.["method"] ?? "");
        expect(m).not.toMatch(METHOD_STUB);
        expect(m.length).toBeGreaterThan(40);
      });
    });
  }
});

// ── Slice 1 — patent search + coverage gate (root failure: searched zero patents) ──
describe("patent-triage v1 · Slice 1 — patent search + coverage gate", () => {
  it("the patent-fetch skill package exists with fixtures", () => {
    expect(skillPkg("patent-fetch")).toBe(true);
    expect(existsSync(join(REPO, "skills", "patent-fetch", "fixtures")), "patent-fetch needs fixtures").toBe(true);
  });
  it("patent-fetch names its corpus (resolved: USPTO PatentsView for slice 1)", () => {
    expect(String(skillMeta("patent-fetch")?.["corpus"] ?? "")).toMatch(/patentsview/i);
  });
  it("the query-expand and citation-verify skills exist", () => {
    expect(skillPkg("query-expand")).toBe(true);
    expect(skillPkg("citation-verify")).toBe(true);
  });
  it("prior-art-scout binds patent-fetch + query-expand + citation-verify", () => {
    const slugs = (agent("prior-art-scout")?.["skill_slugs"] as string[]) ?? [];
    for (const s of ["patent-fetch", "query-expand", "citation-verify"]) expect(slugs, `missing skill ${s}`).toContain(s);
  });
  it("prior-art-scout has a real corpus tool grant AND a turn cap", () => {
    const a = agent("prior-art-scout");
    expect(((a?.["allowed_tools"] as string[]) ?? []).length, "empty cage can't search").toBeGreaterThan(0);
    expect(typeof a?.["max_tool_calls"], "a tool-bearing agent must cap its turns").toBe("number");
  });
  it("a coverage-report domain type records which corpora were searched", () => {
    const t = domainType("coverage-report");
    expect(t, "domain_types/coverage-report.json missing").toBeTruthy();
    expect((t?.["required_fields"] as string[]) ?? []).toContain("corpora_searched");
  });
  it("triage-verdict enumerates INSUFFICIENT-EVIDENCE as a closed recommendation", () => {
    const rec = (props(domainType("triage-verdict"))["recommended"] as { enum?: string[] }) ?? {};
    expect(rec.enum, "recommended must be a closed enum incl INSUFFICIENT-EVIDENCE").toEqual(
      expect.arrayContaining(["FILEABLE", "REFINE-FIRST", "NOT-FILEABLE", "INSUFFICIENT-EVIDENCE"]),
    );
  });
});

// ── Slice 2 — adversary loop + survival gate (resolved: caller-driven + predecessor chain) ──
describe("patent-triage v1 · Slice 2 — examine ⇄ amend loop", () => {
  it("the patent-examiner adversary exists and binds the statutory-checklist skill", () => {
    const a = agent("patent-examiner");
    expect(a, "agents/patent-examiner.json missing").toBeTruthy();
    expect((a?.["skill_slugs"] as string[]) ?? []).toContain("statutory-checklist");
  });
  it("the claim-amender exists", () => expect(agent("claim-amender")).toBeTruthy());
  it("the statutory-checklist skill (§101/§102/§103/§112) exists", () => expect(skillPkg("statutory-checklist")).toBe(true));
  it("an examiner-rejection domain type carries per-statute rejections", () => {
    expect((domainType("examiner-rejection")?.["required_fields"] as string[]) ?? []).toContain("rejections");
  });
  // resolved: caller-driven loop with a hard round cap so an unbounded loop can't hide.
  it("the standard declares max_examine_rounds (the K cap)", () => {
    expect(typeof standard("patent-triage-v1")?.["max_examine_rounds"], "standard needs a K cap").toBe("number");
  });
  // resolved: survival is a predecessor chain, not a mutable counter — recomputable across gigs.
  it("an examine-round-record type chains rounds by predecessor_sha", () => {
    const req = (domainType("examine-round-record")?.["required_fields"] as string[]) ?? [];
    for (const f of ["round_n", "claim_state_sha", "rejection_state_sha", "predecessor_sha"]) {
      expect(req, `examine-round-record missing ${f}`).toContain(f);
    }
  });
});

// ── Slice 3 — element mapping, grounding, single-judge invariant ──
describe("patent-triage v1 · Slice 3 — element mapping + grounding", () => {
  it("the anticipation-mapper exists and binds the element-mapping-matrix skill", () => {
    const a = agent("anticipation-mapper");
    expect(a, "agents/anticipation-mapper.json missing").toBeTruthy();
    expect((a?.["skill_slugs"] as string[]) ?? []).toContain("element-mapping-matrix");
  });
  it("the element-mapping-matrix skill exists", () => expect(skillPkg("element-mapping-matrix")).toBe(true));
  // resolved: drop the hand-typed distance_score; use the matrix-derived, recomputable fraction.
  it("novelty analysis carries coverage_fraction (derived), NOT a hand-typed distance_score", () => {
    const p = props(domainType("novelty-verdict"));
    expect(p["distance_score"], "distance_score must be removed (made-up confidence)").toBeUndefined();
    expect(p["coverage_fraction"], "coverage_fraction (from the matrix) must replace it").toBeTruthy();
  });
  // resolved: single-judge invariant — mapper emits the matrix only; examiner owns the rejection.
  it("anticipation-mapper outputs the matrix only (no rejection type)", () => {
    const outs = (agent("anticipation-mapper")?.["output_types"] as string[]) ?? [];
    expect(outs.length, "anticipation-mapper must declare its outputs (don't pass vacuously)").toBeGreaterThan(0);
    expect(outs).not.toContain("examiner-rejection");
  });
  it("patent-examiner is the only seat that emits examiner-rejection", () => {
    expect(((agent("patent-examiner")?.["output_types"] as string[]) ?? [])).toContain("examiner-rejection");
  });
  it("a prior-art-hit records verification PROVENANCE (fetched vs snippet)", () => {
    const p = props(domainType("prior-art-hit"));
    expect(p["verified"], "prior-art-hit must record verified").toBeTruthy();
    expect(p["verification_method"], "must distinguish fetch from snippet").toBeTruthy();
  });
  // resolved: the snippet-overstatement failure bites the verdict seat too.
  it("triage-judge also binds citation-verify (grounds its OWN cited references)", () => {
    expect((agent("triage-judge")?.["skill_slugs"] as string[]) ?? []).toContain("citation-verify");
  });
});

// ── Slice 4 — enablement draft + auditable verdict ──
describe("patent-triage v1 · Slice 4 — enablement draft + verdict-record", () => {
  it("the spec-drafter exists", () => expect(agent("spec-drafter")).toBeTruthy());
  it("the standard declares the structural evals as eval_slugs", () => {
    const evals = (standard("patent-triage-v1")?.["eval_slugs"] as string[]) ?? [];
    for (const e of ["claim-tree-eval", "enablement-eval"]) expect(evals, `standard missing eval ${e}`).toContain(e);
  });
  // resolved: a FILEABLE verdict must be auditable back to the patents that grounded it.
  it("a verdict-record type carries predecessor links to its inputs", () => {
    const req = (domainType("verdict-record")?.["required_fields"] as string[]) ?? [];
    for (const f of ["disclosure_input_sha", "coverage_report_sha", "examine_round_record_sha"]) {
      expect(req, `verdict-record missing predecessor ${f}`).toContain(f);
    }
  });
});

// ── Gates — the NEGATIVE form (must-fire). The load-bearing half; behavioral, so grounded in
//    tests/patent_triage_v1_gates.test.ts once the standard's deterministic-invoker I/O exists.
describe("patent-triage v1 · gates (must-fire — the half that bites a broken impl)", () => {
  open("coverage-gate-must-fire", {
    question: "Encoded as a hard guard in triage-judge (resolved). The must-fire test: a run whose coverage-report has zero patent corpora yields recommended=INSUFFICIENT-EVIDENCE and can NEVER construct FILEABLE.",
    resolves_when: "patent_triage_v1_gates.test.ts dispatches with a zero-patent coverage-report and asserts recommended===INSUFFICIENT-EVIDENCE.",
    grounding: "needs the v1 standard + a deterministic invoker stubbing the agents' I/O (slice 1 build).",
  });
  open("survival-gate-must-fire", {
    question: "A claim rejected every round (survival_count = walk(predecessor_sha) == 0) can NEVER reach FILEABLE; K-exhausted ⇒ INSUFFICIENT-EVIDENCE.",
    resolves_when: "gates test runs the caller loop to max_examine_rounds with an always-rejecting examiner and asserts the verdict is INSUFFICIENT-EVIDENCE, never FILEABLE.",
    grounding: "needs examine-round-record sealing + the caller-loop harness (slice 2 build).",
  });
  open("draft-gate-must-fire", {
    question: "spec-drafter's phase cannot run unless recommended==FILEABLE AND coverage+survival gates cleared — no §112 draft for a claim that didn't survive examination.",
    resolves_when: "gates test asserts a REFINE-FIRST / INSUFFICIENT verdict produces no provisional-draft output.",
    grounding: "needs the conditional draft phase wiring (slice 4 build).",
  });
});

// ── Cross-cutting ─────────────────────────────────────────────────────────────────
describe("patent-triage v1 · cross-cutting", () => {
  open("retire-v0-roster", {
    question: "Do the v0 agents (diamond-cutter, novelty-searcher, claim-rewriter, verdict-judger) get removed once v1 lands, and is patent-triage-v0 kept as a regression baseline or deleted?",
    resolves_when: "the v0 agents are absent (or deprecated) AND patent-triage-v0's disposition is decided + its e2e test updated.",
    grounding: "decision owner: Eugene; keep diamond-cutting-discipline skill, rebind into claim-architect.",
  });
  open("live-acceptance", {
    question: "v1-better-than-v0 as a sealed, hash-anchored comparison: { v0_gig_sha: 47d06906…, v1_gig_sha, diff_evidence:{patent_hits_delta, enablement_eval_delta}, predecessor_sha: v0_gig_sha }.",
    resolves_when: "a gated COLTRANE_LIVE e2e dispatches patent-triage-v1 on the v0 invention and seals a v1_baseline_comparison showing patent hits present + draft passes enablement-eval.",
    grounding: "v0 baseline is sealed gig 47d06906…; compare against it.",
  });
});
