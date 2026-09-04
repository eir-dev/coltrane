/**
 * The chat-completions AgentInvoker — a cheap model port whose HANDS ARE MCP.
 *
 * THE GAP THIS FILLS. A non-CLI invoker already existed and closed itself off from the work that
 * matters — "v0 is deliberately text-in/JSON-out — no tools, no MCP; a chair that needs tools keeps
 * the Claude invoker." A research or synthesis chair must retrieve,
 * vet, seal and write — every one of those a governed verb over MCP. A toolless cheap invoker
 * cannot do the job at all, so cheap and capable stayed mutually exclusive.
 *
 * WHY THIS IS THE CHEAP HALF, AND NOT A REWRITE OF THE HARNESS. Almost all the difficulty in
 * reimplementing a coding harness is the HOST tool surface — Bash, Edit, the filesystem, and the
 * permission machinery that makes them safe. This invoker refuses every host builtin BY NAME and
 * carries only MCP tools, which arrive already governed by the server that serves them. That is a
 * real deferral of the venue tool runtime, stated out loud, rather than a pretence that it is done.
 *
 * THREE THINGS IT DOES NOT DO, DELIBERATELY:
 *   * It names no provider, no vendor and no service. The base URL, the key and the tier→model map
 *     all arrive through `opts`, because a standard says what work IS and the executor is fungible.
 *   * It reads no environment. Config is the caller's job — the pattern the sibling HTTP invoker
 *     set — which is what keeps the worker-env contract honest about who reads what.
 *   * It never throws. Every failure is a typed refusal in the gig_dispatch shape, so an unwired
 *     deployment, a denied grant and a dead upstream are three distinguishable facts.
 *
 * It reuses the pure prompt stack — `buildPrompt`, `extractJson`, `promptSchemaFor`,
 * `extractOptionsForChair` — because three invokers composing prompts three ways is the drift the
 * shared stack exists to prevent.
 */
import type { AgentInvocationContext, AgentInvoker } from "./runtime.js";
import type { Registry } from "./registry.js";
import type { ModelTier } from "./pricing.js";
import { isHostBuiltin } from "./tool_providers.js";
import {
  buildPrompt,
  extractJson,
  extractOptionsForChair,
  promptSchemaFor,
} from "./claude_invoker.js";

/** One model invocation's wall-clock bound — a completion plus its tool turns, not a whole chair. */
export const DEFAULT_COMPLETIONS_TIMEOUT_MS = 120_000;
/** How many tool round-trips one chair may take before the loop refuses to keep paying. */
export const DEFAULT_MAX_TOOL_ROUNDS = 8;

/** One MCP tool as its server advertises it. */
export interface McpToolDef {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
}

/**
 * The hands. A deployment supplies this — in-process against the engine's own surface, or over the
 * wire to a governed one. The engine ships the loop, the conversion and the refusals; it does not
 * ship a transport, for the same reason it ships no hosted seat backing.
 */
export interface McpToolSource {
  list: () => Promise<readonly McpToolDef[]>;
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface FunctionDef {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface CompletionsInvokerOptions {
  /** Chat-completions base URL. `/chat/completions` is appended. */
  baseUrl: string;
  apiKey: string;
  registry?: Registry | undefined;
  /** ModelTier → the concrete model id. Deployment-defined; the engine hardcodes no names. */
  tierMap?: Partial<Record<ModelTier, string>> | undefined;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
  maxToolRounds?: number | undefined;
  fetchFn?: typeof fetch | undefined;
  tools?: McpToolSource | undefined;
}

export type CompletionsRefusal =
  | "host_tool_denied"
  | "no_tool_source"
  | "transport_failed"
  | "unresolved_tier";

export const COMPLETIONS_REFUSALS: readonly CompletionsRefusal[] = [
  "host_tool_denied",
  "no_tool_source",
  "transport_failed",
  "unresolved_tier",
];

const refuse = (refusal: CompletionsRefusal, message: string): Record<string, unknown> => ({
  ok: false,
  refusal,
  message,
});

// ── MCP ↔ function-calling, losslessly ───────────────────────────────────────────────────────────
//
// Tool names on the wire are constrained to [A-Za-z0-9_-]{1,64}; MCP names are not. A readable name
// survives unchanged (the model reasons better about `mcp__coltrane__output_query` than about a hex
// blob), and anything else is escaped reversibly. The round trip is a law, not an intention.

const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const ESCAPE = "x0_";

export function encodeToolName(name: string): string {
  if (SAFE_NAME.test(name) && !name.startsWith(ESCAPE)) return name;
  let hex = "";
  for (const byte of new TextEncoder().encode(name)) hex += byte.toString(16).padStart(2, "0");
  return ESCAPE + hex;
}

export function fromFunctionName(name: string): string {
  if (!name.startsWith(ESCAPE)) return name;
  const hex = name.slice(ESCAPE.length);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

export function toFunctionDef(tool: McpToolDef): FunctionDef {
  return {
    type: "function",
    function: {
      name: encodeToolName(tool.name),
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      parameters: tool.inputSchema,
    },
  };
}

// ── The invoker ──────────────────────────────────────────────────────────────────────────────────

interface ChatChoice {
  message?: {
    content?: string | null;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
  };
  finish_reason?: string;
}
interface ChatReply {
  choices?: ChatChoice[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function makeCompletionsInvoker(opts: CompletionsInvokerOptions): AgentInvoker {
  const doFetch = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COMPLETIONS_TIMEOUT_MS;
  const maxRounds = opts.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return async (ctx: AgentInvocationContext): Promise<Record<string, unknown>> => {
    const grants = ctx.agent.allowed_tools ?? [];

    // (1) HOST BUILTINS ARE REFUSED BY NAME, before anything is spent. Naming the tool is the
    // difference between a usable refusal and a shrug — and refusing before the wire means a
    // misconfigured chair costs nothing to discover.
    const host = grants.filter((g) => isHostBuiltin(g));
    if (host.length > 0) {
      return refuse(
        "host_tool_denied",
        `agent "${ctx.agent.slug}" grants host builtin(s) [${host.join(", ")}], which this invoker ` +
          `does not carry — its hands are MCP tools only, which arrive governed by the server that ` +
          `serves them. Run this chair on the host-tool invoker, or narrow its grants.`,
      );
    }

    // (2) Grants with no source to satisfy them: a chair advertising tools it cannot reach would
    // confabulate. Absent must mean DECLINE.
    if (grants.length > 0 && !opts.tools) {
      return refuse(
        "no_tool_source",
        `agent "${ctx.agent.slug}" grants [${grants.join(", ")}] but no MCP tool source is wired — ` +
          `a deployment supplies it. Refusing rather than running the chair without its hands.`,
      );
    }

    // (3) The tier must resolve to a concrete model. Guessing one spends real money against a
    // model nobody chose.
    const tier = ctx.agent.model_tier as ModelTier | undefined;
    const model = tier ? opts.tierMap?.[tier] : undefined;
    if (!model) {
      return refuse(
        "unresolved_tier",
        `no model configured for tier "${String(tier ?? "(none)")}" — the tier map is supplied by the ` +
          `deployment, and an unmapped tier is a misconfiguration, not a default.`,
      );
    }

    const types = ctx.output_types?.length ? ctx.output_types : ctx.agent.output_types;
    const single = types.length === 1 ? promptSchemaFor(opts.registry, types[0]) : undefined;
    const many =
      types.length > 1
        ? Object.fromEntries(types.map((t) => [t, promptSchemaFor(opts.registry, t)]))
        : undefined;
    const prompt = buildPrompt(ctx, single, many);

    const defs = opts.tools ? (await opts.tools.list()).map(toFunctionDef) : [];
    const messages: Record<string, unknown>[] = [{ role: "user", content: prompt }];

    let reply: ChatReply | undefined;
    for (let round = 0; round <= maxRounds; round++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            ...(defs.length > 0 ? { tools: defs } : {}),
            ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
          }),
          signal: ctx.signal ?? controller.signal,
        });
      } catch (e) {
        return refuse("transport_failed", `the completions endpoint could not be reached: ${String(e)}`);
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return refuse("transport_failed", `completions ${res.status}: ${body.slice(0, 300)}`);
      }
      reply = (await res.json()) as ChatReply;

      const choice = reply.choices?.[0];
      const calls = choice?.message?.tool_calls ?? [];
      if (calls.length === 0) break;

      // The tool loop. Every call goes back out through the SOURCE — the engine resolves nothing
      // itself, so whatever governs that surface governs this chair.
      messages.push({ role: "assistant", content: null, tool_calls: calls });
      for (const call of calls) {
        const wire = call.function?.name ?? "";
        const name = fromFunctionName(wire);
        let result: unknown;
        try {
          const args = JSON.parse(call.function?.arguments || "{}") as Record<string, unknown>;
          result = await opts.tools!.call(name, args);
        } catch (e) {
          result = { error: String(e) };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id ?? wire,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
    }

    // Usage, reported ONLY as far as the transport actually reported it. Fabricating a zero is how
    // "not captured" becomes "$0.00 spent" (#235) — and the model id is what the seal stamps, so an
    // invented one would put a lie in the chain.
    const served = reply?.model;
    const inTok = reply?.usage?.prompt_tokens;
    const outTok = reply?.usage?.completion_tokens;
    if (served !== undefined || inTok !== undefined || outTok !== undefined) {
      ctx.onEvent?.({
        type: "result",
        raw: {
          ...(inTok !== undefined || outTok !== undefined
            ? { usage: { input_tokens: inTok ?? 0, output_tokens: outTok ?? 0 } }
            : {}),
          ...(served !== undefined
            ? { modelUsage: { [served]: { inputTokens: inTok ?? 0, outputTokens: outTok ?? 0 } } }
            : {}),
        },
      });
    }

    const text = reply?.choices?.[0]?.message?.content ?? "";
    return extractJson(text, extractOptionsForChair(types, single));
  };
}
