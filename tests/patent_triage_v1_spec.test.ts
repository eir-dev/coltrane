// SPEC — patent-triage v1 upgrade, defined by its acceptance tests.
//
// Plan: docs/patent-triage-v1-upgrade.md. This file IS the contract: each it() is a
// structural acceptance criterion that FAILS until the genome is authored to meet it (RED —
// "contract defined, code missing"), and each open() is a design fork to resolve before/while
// building (OPEN — "contract not grounded yet"). This branch is RED by design; a slice is
// done when its describe() block goes green. Nothing here imports not-yet-existing code — the
// contracts read the genome (agents/skills/standards/domain_types) off disk, so the file
// always collects cleanly and the failures are the spec, not crashes.
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
const skillPkg = (slug: string) => existsSync(join(REPO, "skills", slug, "meta.json"));

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
    const s = standard("patent-triage-v1");
    const phases = ((s?.["phases"] as Array<{ name: string }>) ?? []).map((p) => p.name);
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
  it("triage-verdict enumerates INSUFFICIENT-EVIDENCE as a recommendation", () => {
    const t = domainType("triage-verdict");
    const rec = ((t?.["schema"] as { properties?: { recommended?: { enum?: string[] } } })?.properties?.recommended) ?? {};
    expect(rec.enum, "recommended must be a closed enum incl INSUFFICIENT-EVIDENCE").toEqual(
      expect.arrayContaining(["FILEABLE", "REFINE-FIRST", "NOT-FILEABLE", "INSUFFICIENT-EVIDENCE"]),
    );
  });

  open("coverage-gate-wiring", {
    question: "How is 'no FILEABLE without ≥1 patent corpus with results' enforced — a standard eval_slug that fails/flags the gig, or a hard guard inside triage-judge's verdict contract?",
    resolves_when: "patent_triage_v1_gates.test.ts asserts a coverage-less run yields recommended=INSUFFICIENT-EVIDENCE, never FILEABLE.",
    grounding: "decision: Eugene + reviewer; the gate must be testable on a deterministic-invoker run.",
  });
  open("patent-corpus-choice", {
    question: "Which patent corpus backs patent-fetch — USPTO PatentsView (free, structured JSON, no key) or a keyed API (Espacenet OPS / Lens.org) with broader coverage?",
    resolves_when: "skills/patent-fetch/meta.json names the corpus + auth model and a fixture exercises a real query shape.",
    grounding: "PatentsView API docs vs Espacenet OPS / Lens terms; coverage vs key-management cost.",
  });
});

// ── Slice 2 — adversary loop + survival gate (root failure: never questioned the claim) ──
describe("patent-triage v1 · Slice 2 — examine ⇄ amend loop", () => {
  it("the patent-examiner adversary exists and binds the statutory-checklist skill", () => {
    const a = agent("patent-examiner");
    expect(a, "agents/patent-examiner.json missing").toBeTruthy();
    expect((a?.["skill_slugs"] as string[]) ?? []).toContain("statutory-checklist");
  });
  it("the claim-amender exists", () => expect(agent("claim-amender")).toBeTruthy());
  it("the statutory-checklist skill (§101/§102/§103/§112) exists", () => expect(skillPkg("statutory-checklist")).toBe(true));
  it("an examiner-rejection domain type carries per-statute rejections", () => {
    const t = domainType("examiner-rejection");
    expect(t, "domain_types/examiner-rejection.json missing").toBeTruthy();
    expect((t?.["required_fields"] as string[]) ?? []).toContain("rejections");
  });

  open("examine-amend-loop-shape", {
    question: "Is the examine⇄amend cycle caller-driven (the MCP client re-dispatches rounds until the verdict stabilizes) or unrolled into fixed phases (examine-1, amend-1, examine-2, amend-2)?",
    resolves_when: "the standard's phases (unrolled) OR a documented caller-loop protocol + its termination test exist.",
    grounding: "composeStandard forbids DAG cycles; decide caller-driven vs unrolled-K with K fixed.",
  });
  open("survival-gate", {
    question: "How is 'FILEABLE requires the claim survived ≥1 examine round' enforced and counted across a caller-driven loop where each round is a separate gig?",
    resolves_when: "a run whose claim is rejected every round cannot reach FILEABLE (asserted in the gates test).",
    grounding: "depends on examine-amend-loop-shape; survival count must persist across gigs if caller-driven.",
  });
});

// ── Slice 3 — element mapping + grounding gate (the Nightfall overstatement) ──
describe("patent-triage v1 · Slice 3 — element mapping + grounding", () => {
  it("the anticipation-mapper exists and binds the element-mapping-matrix skill", () => {
    const a = agent("anticipation-mapper");
    expect(a, "agents/anticipation-mapper.json missing").toBeTruthy();
    expect((a?.["skill_slugs"] as string[]) ?? []).toContain("element-mapping-matrix");
  });
  it("the element-mapping-matrix skill exists", () => expect(skillPkg("element-mapping-matrix")).toBe(true));
  it("a prior-art-hit records verification PROVENANCE (fetched vs snippet)", () => {
    const t = domainType("prior-art-hit");
    const props = ((t?.["schema"] as { properties?: Record<string, unknown> })?.properties) ?? {};
    expect(props["verified"], "prior-art-hit must record verified").toBeTruthy();
    expect(props["verification_method"], "must distinguish fetch from snippet").toBeTruthy();
  });

  open("grounding-gate", {
    question: "How is 'an anticipation finding may cite only a fetched (not snippet) verified reference' enforced — a citation-verify skill gate in prior-art-scout, or an eval over the novelty analysis?",
    resolves_when: "a finding citing a snippet-only source cannot be marked anticipating (asserted in the gates test).",
    grounding: "the v0 Nightfall hit asserted a behavior the source didn't state, from a snippet.",
  });
  open("distance-score-metric", {
    question: "The v0 novelty-verdict emitted distance_score: 0.62 with no defined metric. Define it (what 0..1 measures, computed by which skill) or drop it for an element-coverage fraction from the matrix?",
    resolves_when: "either element-mapping-matrix computes a defined coverage score, or distance_score is removed from the type.",
    grounding: "decision: a made-up confidence number is worse than none; prefer a derived, explainable measure.",
  });
});

// ── Slice 4 — enablement drafting + structural evals (failures 3 & 4) ──
describe("patent-triage v1 · Slice 4 — enablement draft + structural evals", () => {
  it("the spec-drafter exists", () => expect(agent("spec-drafter")).toBeTruthy());
  it("the standard declares the structural evals as eval_slugs", () => {
    const evals = (standard("patent-triage-v1")?.["eval_slugs"] as string[]) ?? [];
    for (const e of ["claim-tree-eval", "enablement-eval", "coverage-gate", "grounding-gate", "survival-gate"]) {
      expect(evals, `standard missing eval ${e}`).toContain(e);
    }
  });

  open("enablement-eval", {
    question: "What concretely counts as §112 enablement for the provisional-draft — ≥1 worked embodiment + a how-to-build section + ≥1 non-outline paragraph in Detailed Description?",
    resolves_when: "a draft whose Detailed Description is only an outline FAILS enablement-eval; one with a worked embodiment passes.",
    grounding: "the v0 draft's Detailed Description was an outline with zero embodiments.",
  });
  open("claim-tree-eval", {
    question: "Minimum claim-tree shape for a fileable verdict — ≥1 independent + ≥2 dependents, with each dependent narrowing a named element?",
    resolves_when: "a single-independent-no-dependents claim set fails claim-tree-eval.",
    grounding: "v0 produced one independent claim restated twice; dependents were boilerplate bolted on at the end.",
  });
});

// ── Cross-cutting ─────────────────────────────────────────────────────────────────
describe("patent-triage v1 · cross-cutting", () => {
  open("retire-v0-roster", {
    question: "Do the v0 agents (diamond-cutter, novelty-searcher, claim-rewriter, verdict-judger) get removed once the v1 roster lands, and is patent-triage-v0 kept as a regression baseline or deleted?",
    resolves_when: "the v0 agents are absent (or marked deprecated) AND patent-triage-v0's disposition is decided + its e2e test updated.",
    grounding: "decision owner: Eugene; keep diamond-cutting-discipline skill, rebind into claim-architect.",
  });
  open("live-acceptance", {
    question: "What live run proves v1 is better than v0 — same invention, asserting the verdict is now grounded (patent hits present) and the draft enables?",
    resolves_when: "a gated COLTRANE_LIVE e2e dispatches patent-triage-v1 on the v0 invention and asserts coverage-report has patent hits + draft passes enablement-eval.",
    grounding: "the v0 baseline run is sealed gig 47d06906…; compare against it.",
  });
});
