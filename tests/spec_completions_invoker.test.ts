// RED — Stage A of the cheap band: an OpenAI-compatible invoker whose HANDS ARE MCP.
//
// WHY THIS EXISTS. src/bifrost_invoker.ts is already a complete second AgentInvoker, and it is
// useless for research/synthesis because of one self-declared limit (bifrost_invoker.ts:5):
// "v0 is deliberately text-in/JSON-out — no tools, no MCP; a chair that needs tools keeps the
// Claude invoker." A research chair must retrieve, vet, seal and write — every one a governed
// verb over MCP. A toolless cheap invoker cannot do the work at all.
//
// AND THIS IS THE CHEAP HALF. The expensive part of a model-agnostic runtime is the HOST tool
// surface — Bash, Edit, filesystem, permissions. An invoker whose only hands are MCP inherits
// governance from the server and needs none of that machinery. So it REFUSES a host-builtin
// grant by name, which defers that work honestly instead of pretending it is solved.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TEST_BEHAVIOR } from "./_support/agents.js";
import { createRegistry, type DomainType, type Agent, type AgentInvocationContext } from "../src";
import {
  loadCompletions,
  fakeCompletions,
  recordingTools,
  saysJson,
  callsTool,
  type CompletionsModule,
  type McpToolDef,
} from "./spec_completions_fixtures.js";

const SRC = new URL("../src/", import.meta.url).pathname;

const note: DomainType = {
  slug: "research-note",
  extends: "Signal",
  domain: "research",
  schema: { properties: { claim: { type: "string" }, source: { type: "string" } } },
  required_fields: ["claim", "source"],
};

/** A research chair: MCP hands only. */
const researcher: Agent = {
  ...TEST_BEHAVIOR,
  slug: "researcher",
  primitives: ["SENSE"],
  input_types: [],
  output_types: ["research-note"],
  domain: "research",
  model_tier: "economy",
  allowed_tools: ["mcp__coltrane__output_query", "output_write"],
};

/** The same chair, reaching for a host builtin. */
const shellUser: Agent = { ...researcher, slug: "shell-user", allowed_tools: ["Bash", "mcp__coltrane__output_query"] };

const TOOLS: McpToolDef[] = [
  { name: "mcp__coltrane__output_query", description: "read sealed outputs", inputSchema: { type: "object", properties: { gig_id: { type: "string" } }, required: ["gig_id"] } },
];

function ctxFor(agent: Agent): AgentInvocationContext {
  return { agent, phase: "gather", inputs: [], gig_input: { goal: "find one claim" } };
}

function opts(over: Record<string, unknown> = {}) {
  const registry = createRegistry();
  registry.registerType(note);
  return { baseUrl: "https://endpoint.test/v1", apiKey: "k", registry, tierMap: { economy: "cheap-model-1" }, ...over };
}

describe("LAW 1 — it is an AgentInvoker, and it answers the typed blob", () => {
  it("returns the chair's output shape from a plain completion", async () => {
    const C: CompletionsModule = await loadCompletions();
    const { fn } = fakeCompletions([saysJson({ claim: "the sky is blue", source: "https://x.test/a" })]);
    const { source } = recordingTools(TOOLS);
    const invoke = C.makeCompletionsInvoker(opts({ fetchFn: fn, tools: source }));
    const out = await invoke(ctxFor(researcher));
    expect(out).toEqual({ claim: "the sky is blue", source: "https://x.test/a" });
  });

  it("sends the tier's concrete model, never a tier name", async () => {
    const C: CompletionsModule = await loadCompletions();
    const { fn, calls } = fakeCompletions([saysJson({ claim: "c", source: "s" })]);
    const { source } = recordingTools(TOOLS);
    await C.makeCompletionsInvoker(opts({ fetchFn: fn, tools: source }))(ctxFor(researcher));
    expect(calls[0]?.body["model"], "the wire carried a tier instead of a model").toBe("cheap-model-1");
  });
});

describe("LAW 2/3 — host builtins refused BY NAME; MCP chairs run", () => {
  it("a host-builtin grant is refused by name, before any network call", async () => {
    const C: CompletionsModule = await loadCompletions();
    const { fn, calls } = fakeCompletions([saysJson({ claim: "c", source: "s" })]);
    const { source } = recordingTools(TOOLS);
    const invoke = C.makeCompletionsInvoker(opts({ fetchFn: fn, tools: source }));

    const res = (await invoke(ctxFor(shellUser))) as Record<string, unknown>;
    expect(res["ok"], "a chair holding Bash was run on the cheap path").toBe(false);
    expect(res["refusal"]).toBe("host_tool_denied");
    // NAMING the tool is the difference between a usable refusal and a shrug.
    expect(String(res["message"] ?? "")).toContain("Bash");
    expect(calls.length, "a refused chair still reached the wire").toBe(0);
  });

  it("an MCP-only chair RUNS, and its tool call reaches the surface", async () => {
    // THE GUARD ON THE LAW ABOVE. Without this, the refusal law could be refusing everything
    // and proving nothing — the exact defect a reviewer found in the reside mount law.
    const C: CompletionsModule = await loadCompletions();
    const { fn } = fakeCompletions([
      callsTool("mcp__coltrane__output_query", { gig_id: "g1" }),
      saysJson({ claim: "found it", source: "sealed://g1" }),
    ]);
    const { source, called } = recordingTools(TOOLS, { mcp__coltrane__output_query: { rows: 1 } });
    const invoke = C.makeCompletionsInvoker(opts({ fetchFn: fn, tools: source }));

    const out = await invoke(ctxFor(researcher));
    expect(called.map((c) => c.name), "the tool call never reached the surface").toEqual([
      "mcp__coltrane__output_query",
    ]);
    expect(called[0]?.args).toEqual({ gig_id: "g1" });
    expect(out).toEqual({ claim: "found it", source: "sealed://g1" });
  });

  it("a chair with tool grants and NO tool source is refused, not run blind", async () => {
    const C: CompletionsModule = await loadCompletions();
    const { fn, calls } = fakeCompletions([saysJson({ claim: "c", source: "s" })]);
    const res = (await C.makeCompletionsInvoker(opts({ fetchFn: fn }))(ctxFor(researcher))) as Record<string, unknown>;
    expect(res["refusal"]).toBe("no_tool_source");
    expect(calls.length).toBe(0);
  });
});

describe("LAW 4 — the MCP↔OpenAI conversion is lossless", () => {
  it("an MCP tool becomes a function definition and its name reads back", async () => {
    const C: CompletionsModule = await loadCompletions();
    const def = C.toFunctionDef(TOOLS[0]!);
    expect(def.type).toBe("function");
    expect(def.function.parameters, "the tool's schema was not carried over").toEqual(TOOLS[0]!.inputSchema);
    expect(C.fromFunctionName(def.function.name), "the round trip lost the tool's identity").toBe(
      TOOLS[0]!.name,
    );
  });

  it("a tool whose name is not OpenAI-safe still round-trips", async () => {
    const C: CompletionsModule = await loadCompletions();
    const odd: McpToolDef = { name: "mcp__a.b__c-d", inputSchema: { type: "object" } };
    expect(C.fromFunctionName(C.toFunctionDef(odd).function.name)).toBe(odd.name);
  });
});

describe("LAW 8 — a transport failure is a typed refusal, never a throw", () => {
  it("a non-2xx becomes {ok:false, refusal:'transport_failed'}", async () => {
    const C: CompletionsModule = await loadCompletions();
    const { fn } = fakeCompletions([{ error: "upstream is down" }], 502);
    const { source } = recordingTools(TOOLS);
    let threw: unknown = null;
    let res: Record<string, unknown> = {};
    try {
      res = (await C.makeCompletionsInvoker(opts({ fetchFn: fn, tools: source }))(ctxFor(researcher))) as Record<string, unknown>;
    } catch (e) {
      threw = e;
    }
    expect(threw, "the invoker threw instead of refusing").toBe(null);
    expect(res["refusal"]).toBe("transport_failed");
  });

  it("a tier with no configured model refuses 'unresolved_tier' rather than guessing", async () => {
    const C: CompletionsModule = await loadCompletions();
    const { fn, calls } = fakeCompletions([saysJson({ claim: "c", source: "s" })]);
    const { source } = recordingTools(TOOLS);
    const res = (await C.makeCompletionsInvoker(opts({ fetchFn: fn, tools: source, tierMap: {} }))(
      ctxFor(researcher),
    )) as Record<string, unknown>;
    expect(res["refusal"]).toBe("unresolved_tier");
    expect(calls.length, "it guessed a model and spent anyway").toBe(0);
  });
});

describe("LAW 10 — the engine names no platform and reads no environment", () => {
  it("the invoker reads no process.env and names no vendor", () => {
    const path = join(SRC, "completions_invoker.ts");
    expect(existsSync(path), "src/completions_invoker.ts does not exist yet").toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text, "the invoker reads the environment; config belongs in opts").not.toMatch(
      /process\.env\[/,
    );
    for (const name of ["openrouter", "openai.com", "anthropic", "bifrost", "deepseek"]) {
      expect(text.toLowerCase(), `the engine names the provider "${name}"`).not.toContain(name);
    }
  });
});
