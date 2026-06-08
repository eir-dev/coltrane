// Chairs in Coltrane OSS — contract tests.
//
// Pre-reg (per /tmp/chairs_spec.md / migration folder spec v0):
//
// PhaseDef changes from `{ name, agent }` to `{ name, chairs: Chair[] }`.
// Chair = {
//   role: string,
//   agent_slug: string,
//   depends_on: string[],
//   input_contract: string[],
//   output_contract: string[],
//   required_skills: string[],
// }
//
// chairs[] is REQUIRED (length ≥ 1). agent_slug at PhaseDef level is REMOVED.
// No dual-shape carry-on. Existing standards migrate to single-chair phases
// via a codemod that runs once.
//
// This file is RED-honest. Every test calls into the new chairs API; nothing
// runs until composition + runtime + loader lands. When the implementation
// PR lands, every test in §A and §B should flip GREEN; §C runtime tests
// flip GREEN when the parallel chair dispatcher lands.

import { describe, it, expect } from "vitest";
import {
  defineAgent,
  composeStandard,
  CompositionError,
  // The new types — these don't exist yet; they flip GREEN when the schema
  // change lands in src/composition.ts.
  // @ts-expect-error — pending implementation
  type Chair,
  // @ts-expect-error — pending implementation
  type PhaseDef,
} from "../src";

// Test fixtures: a minimal genome that satisfies type-graph constraints so
// the chair-specific contracts are the only thing under test.

function agent(slug: string, opts: Partial<{ skill_slugs: string[]; input_types: string[]; output_types: string[] }> = {}) {
  return defineAgent({
    slug,
    primitives: ["INTERPRET"],
    input_types: opts.input_types ?? ["Signal"],
    output_types: opts.output_types ?? ["Interpretation"],
    domain: null,
    skill_slugs: opts.skill_slugs ?? [],
  });
}

function chair(role: string, agent_slug: string, opts: Partial<Chair> = {}): Chair {
  return {
    role,
    agent_slug,
    depends_on: opts.depends_on ?? [],
    input_contract: opts.input_contract ?? [],
    output_contract: opts.output_contract ?? [],
    required_skills: opts.required_skills ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §A. Schema contracts at compose time
// ─────────────────────────────────────────────────────────────────────────────

describe("chairs §A — schema contracts at compose time", () => {
  it("accepts a single-chair phase (regression: single-agent shape preserved)", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          { name: "p1", chairs: [chair("solo", "a")] } as PhaseDef,
        ],
      }),
    ).not.toThrow();
  });

  it("accepts a multi-chair phase with parallel chairs (fan-out)", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          {
            name: "fan-out",
            chairs: [
              chair("r1", "a"),
              chair("r2", "a"),
              chair("r3", "a"),
            ],
          } as PhaseDef,
        ],
      }),
    ).not.toThrow();
  });

  it("accepts cross-phase depends_on (chair in phase 2 depends on chair in phase 1)", () => {
    const a = agent("a", { output_types: ["Interpretation"] });
    const b = agent("b", { input_types: ["Interpretation"], output_types: ["Plan"] });
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a, b],
        phases: [
          { name: "p1", chairs: [chair("upstream", "a", { output_contract: ["Interpretation"] })] } as PhaseDef,
          {
            name: "p2",
            chairs: [
              chair("downstream", "b", {
                depends_on: ["upstream"],
                input_contract: ["Interpretation"],
                output_contract: ["Plan"],
              }),
            ],
          } as PhaseDef,
        ],
      }),
    ).not.toThrow();
  });

  it("rejects empty chairs array", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [{ name: "p1", chairs: [] } as PhaseDef],
      }),
    ).toThrow(CompositionError);
  });

  it("rejects duplicate role within a standard", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          {
            name: "p1",
            chairs: [chair("dup", "a"), chair("dup", "a")],
          } as PhaseDef,
        ],
      }),
    ).toThrow(/duplicate role/i);
  });

  it("rejects duplicate role across phases within a standard", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          { name: "p1", chairs: [chair("same", "a")] } as PhaseDef,
          { name: "p2", chairs: [chair("same", "a")] } as PhaseDef,
        ],
      }),
    ).toThrow(/duplicate role/i);
  });

  it("rejects cycle in depends_on (A → B → A within a phase)", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          {
            name: "p1",
            chairs: [
              chair("A", "a", { depends_on: ["B"] }),
              chair("B", "a", { depends_on: ["A"] }),
            ],
          } as PhaseDef,
        ],
      }),
    ).toThrow(/cycle/i);
  });

  it("rejects self-referencing depends_on (A → A)", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          {
            name: "p1",
            chairs: [chair("A", "a", { depends_on: ["A"] })],
          } as PhaseDef,
        ],
      }),
    ).toThrow(/cycle|self/i);
  });

  it("rejects forward reference in depends_on (depends on a role defined in a LATER phase)", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          {
            name: "p1",
            chairs: [chair("upstream", "a", { depends_on: ["downstream"] })],
          } as PhaseDef,
          {
            name: "p2",
            chairs: [chair("downstream", "a")],
          } as PhaseDef,
        ],
      }),
    ).toThrow(/forward|undeclared|unknown role/i);
  });

  it("rejects chair referencing unknown role in depends_on", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          {
            name: "p1",
            chairs: [chair("A", "a", { depends_on: ["nonexistent"] })],
          } as PhaseDef,
        ],
      }),
    ).toThrow(/unknown role|undeclared/i);
  });

  it("rejects chair with agent_slug not in standard's agents list", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [{ name: "p1", chairs: [chair("A", "nope")] } as PhaseDef],
      }),
    ).toThrow(/unknown agent|not in standard/i);
  });

  it("rejects chair requiring skill not in agent's skill_slugs", () => {
    const a = agent("a", { skill_slugs: ["sk1"] });
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          {
            name: "p1",
            chairs: [chair("A", "a", { required_skills: ["sk2"] })],
          } as PhaseDef,
        ],
      }),
    ).toThrow(/skill|not declared/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §B. Type-graph contracts (input_contract / output_contract integrity)
// ─────────────────────────────────────────────────────────────────────────────

describe("chairs §B — input_contract / output_contract integrity", () => {
  it("rejects chair whose input_contract is not satisfied by upstream chairs", () => {
    const a = agent("a", { output_types: ["Interpretation"] });
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          {
            name: "p1",
            chairs: [
              chair("solo", "a", {
                input_contract: ["NeverProducedType"],
                output_contract: ["Interpretation"],
              }),
            ],
          } as PhaseDef,
        ],
      }),
    ).toThrow(/input_contract|not satisfied|not produced/i);
  });

  it("accepts chair whose input_contract IS satisfied by an upstream chair's output_contract", () => {
    const a = agent("a", { output_types: ["Interpretation"] });
    const b = agent("b", { input_types: ["Interpretation"], output_types: ["Plan"] });
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a, b],
        phases: [
          {
            name: "p1",
            chairs: [
              chair("first", "a", { output_contract: ["Interpretation"] }),
              chair("second", "b", {
                depends_on: ["first"],
                input_contract: ["Interpretation"],
                output_contract: ["Plan"],
              }),
            ],
          } as PhaseDef,
        ],
      }),
    ).not.toThrow();
  });

  it("rejects chair whose output_contract is empty (every chair must produce something)", () => {
    const a = agent("a");
    expect(() =>
      composeStandard({
        slug: "s",
        domain: "test",
        agents: [a],
        phases: [
          { name: "p1", chairs: [chair("solo", "a", { output_contract: [] })] } as PhaseDef,
        ],
      }),
    ).toThrow(/output_contract|empty/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §C. Runtime contracts (RED until parallel dispatcher lands)
// ─────────────────────────────────────────────────────────────────────────────

describe("chairs §C — runtime parallel-dispatch contracts (RED until executor)", () => {
  it.todo(
    "runGig dispatches a single-chair phase identically to today's single-agent phase (regression)",
  );
  it.todo(
    "runGig dispatches multi-chair fan-out in parallel and gathers all outputs into the next phase's scope",
  );
  it.todo(
    "runGig respects depends_on: a chair starts only after every chair in its depends_on completes",
  );
  it.todo(
    "runGig validates chair.output_contract after invocation; missing output → phase aborts with named chair",
  );
  it.todo(
    "runGig validates chair.input_contract before invocation; missing input → phase aborts before dispatch",
  );
  it.todo(
    "runGig: if ANY chair in a topological level fails, the whole phase fails with the named failing chair(s)",
  );
  it.todo(
    "runGig: cross-phase depends_on works — chair in phase N depends on chair in phase 0..N-1",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §D. Chain-receipt contracts (RED until chain-keeper extends)
// ─────────────────────────────────────────────────────────────────────────────

describe("chairs §D — chain-receipt per-chair settlement (RED until chain extends)", () => {
  it.todo(
    "each chair emits a settlement event with kind='chair_settled', role=<role>, phase=<phase name>",
  );
  it.todo(
    "chair settlement's derived_from is the union of the gig prereg sha and the settlements of chairs in depends_on",
  );
  it.todo(
    "phase settlement aggregates all chair settlements; gig settlement aggregates phase settlements",
  );
  it.todo(
    "chain replay reproduces the gig output by walking chair settlements in topological order",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// §E. Migration / codemod contracts (RED until codemod runs)
// ─────────────────────────────────────────────────────────────────────────────

describe("chairs §E — migration from agent → chairs[] (RED until codemod)", () => {
  it.todo(
    "codemod converts existing phase.agent='X' to phase.chairs=[{role:'X', agent_slug:'X', depends_on:[], input_contract:<inferred>, output_contract:<inferred>, required_skills:<inferred>}]",
  );
  it.todo(
    "codemod fails loudly on a standard it cannot convert (e.g., agent has no input/output types to infer the contract)",
  );
  it.todo(
    "after codemod runs on all 7 existing standards in coltrane-oss, full vitest passes",
  );
  it.todo(
    "loader rejects any standard JSON containing legacy `phase.agent` field after the codemod transition",
  );
});
