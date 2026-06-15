# Weave: Design Document

> Name resolved: **Weave**. The npm package and GitHub repo are `weave-lang` (bare `weave` is taken); source files use the `.weave` extension. See [Naming](#16-naming).

Status: v0 built and running (2026-06-15)
Owner: PythonLuvr
Last updated: 2026-06-15

---

## 0. One line

Weave is a small, verifiable language for orchestrating AI agents, designed so that a model can be taught the entire language in-context and cannot quietly produce a broken program.

---

## 1. Why this exists (the honest thesis)

Agents are a new computing primitive and they do not have a native language. Everyone building them today glues Python or TypeScript together with libraries (LangChain, CrewAI, the Agent SDK). That works, but it is the assembly-language phase of a primitive that will eventually get its own clean abstraction. Weave is a bet on what that abstraction looks like.

The design is shaped by one piece of honesty we worked out before writing this doc:

**A new language is not easier for an AI to write.** Models are good at Python and JS because they have seen billions of lines of it. A brand-new language has zero training data, so on raw generation fluency it starts behind, the same way models are worse at low-resource human languages. Any pitch that rests on "the AI will write this more fluently than Python" loses to the training corpus. We are not making that claim.

The claim we **are** making is narrower and survives scrutiny:

> The value of designing a language for AI is not fluency. It is **trust**. A small, constrained, verifiable DSL lets the model produce code that cannot be syntactically invalid, cannot express whole classes of bugs, fits entirely in the prompt so the data gap never bites, and gets caught the instant it is wrong.

Everything in this document follows from that sentence. If a feature does not serve smallness, constraint, or verifiability, it does not belong in v0.

---

## 2. The five design pillars

These come straight from the honest reckoning. Each one is data-independent: it works even though no model was ever trained on Weave.

1. **Small surface, teachable in-context.** The whole language fits in a few hundred lines of spec plus examples. So instead of relying on training data, we paste the complete reference into the model's prompt. The data gap only hurts large languages. A tiny DSL sidesteps it.

2. **Illegal states are unrepresentable.** The grammar and type system are built so that entire categories of bugs cannot be written. The model is not trusted to avoid them. It is structurally prevented from expressing them. (This is the same reason models produce fewer memory bugs in Rust than in C.)

3. **Constrained generation.** The grammar is small and formal, so we can emit a constrained-decoding grammar (GBNF-style) that forces a model to output only syntactically valid Weave. You cannot do this with full Python. The smallness is what unlocks the guarantee.

4. **Verifiability over trust.** Contracts (`require` / `ensure`) and a real type checker mean wrongness is caught at compile or run time, cheaply, instead of in production. AI code's actual failure mode is being confidently wrong, so catching it is the whole game.

5. **Embed in a high-resource host.** Weave compiles to TypeScript over a runtime that wraps existing model calls, MCP tools, and CLIs. We inherit the ecosystem, the tooling, and an execution layer that already exists, rather than reinventing a runtime.

---

## 3. Non-goals

Scope discipline is what keeps the honest thesis honest. Weave is explicitly **not**:

- A general-purpose programming language. General purpose means a huge surface, which kills pillars 1 and 3. Weave is a DSL on purpose.
- A faster language. No performance claims. The host runtime does the work.
- A replacement for your normal code. Weave orchestrates; it calls out to real functions and tools for anything computational.
- A claim that "AI writes Weave better than Python." It does not, and we do not pretend otherwise.
- A model. Weave calls models. It is not one.

---

## 4. Core concepts

Weave has exactly five nouns. That is the entire conceptual surface.

| Concept | What it is |
|---|---|
| `type` | A shape for data. Records, unions, lists, primitives. Where contracts attach. |
| `tool` | A typed binding to a real function: an MCP tool, a CLI, an HTTP call, a host function. |
| `agent` | A configured model caller: which model, which tools, which memory, which persona. |
| `flow` | The orchestration unit. Typed inputs and outputs, a body of steps, contracts. |
| soft call | Invoking an agent with a prompt template and getting a typed result back. |

That is it. Five things. If you understand these five, you understand the language, which is the point of pillar 1.

---

## 5. Language tour

### 5.1 Primitives and types

```weave
type Topic = text
type Mood  = "positive" | "negative" | "neutral"

type Post = {
  body: text
  cta: text
}
```

Types are structural. Unions of string literals are how you get enums. Constraints live in contracts, not in the type, to keep the type grammar tiny (pillar 1).

### 5.2 Tools

A tool is a typed door to the outside world. The signature is Weave; the implementation is host code.

```weave
tool web_search(query: text) -> list<text>
tool fact_check(claim: text) -> bool
tool publish(post: Post) -> text          // returns the published URL
```

Tools can be backed by MCP servers, CLIs (Gemini, Magnific), HTTP endpoints, or plain TypeScript functions. The binding lives in the host config, not in the Weave file.

### 5.3 Agents

```weave
agent researcher {
  model:  gemini-flash
  tools:  [web_search]
  memory: session
  retry:  2
}

agent writer {
  model:  claude
  persona: "Brand-true social copywriter. No em dashes. No hashtags."
  retry:  3
}
```

An agent is just configuration. It does nothing until a flow calls it.

### 5.4 Flows and soft calls

A flow is the program. Each `->` binds a step's result to a name. A bare agent or tool call is a step.

```weave
flow topic_to_post(topic: Topic) -> Post {
  require topic != ""                                  // precondition

  researcher("find 3 recent facts about {topic}") -> facts: list<text>

  // verifiability where it matters: every claim is checked
  for f in facts {
    ensure fact_check(f)
  }

  writer("write a post from these facts: {facts}") -> draft: Post

  ensure draft.body.length <= 280                      // structural guardrail
  ensure draft.cta != ""                               // always a CTA
  ensure no_em_dashes(draft.body)                      // built-in lint, enforced
  return draft
}
```

> `no_em_dashes` is a built-in lint that rejects the em dash glyph, so a Weave file can ban that character without ever embedding it. Built-in lints exist for exactly the guardrails (banned glyphs, profanity, PII patterns) that are awkward to express as raw string comparisons.

Two things are happening at once here, and they are the whole product:

- The `researcher(...) ->` / `writer(...) ->` lines are **orchestration** (the agent-DSL idea).
- The `require` / `ensure` lines are **verification** (the AI-trust idea).

Different concerns, same file, each doing its own job.

### 5.5 Control flow

Minimal on purpose.

```weave
if mood == "negative" {
  writer("write an apologetic reply") -> reply
} else {
  writer("write a warm thank-you reply") -> reply
}

for review in reviews {
  classifier("classify: {review}") -> mood: Mood
}

parallel {
  researcher("angle A: {topic}") -> a
  researcher("angle B: {topic}") -> b
}
```

`parallel` is a barrier: it runs the branches concurrently and waits for all of them. Independent steps outside a `parallel` block may also be scheduled concurrently by the runtime based on the data-dependency graph (see [Execution model](#8-execution-model)). (`parallel` is implemented; the implicit DAG auto-scheduler is still v1.)

### 5.6 Human in the loop

A first-class step, because your work always has an approval gate.

```weave
flow post_with_approval(topic: Topic) -> text {
  topic_to_post(topic) -> draft
  review draft -> approved: Post        // pauses, waits for a human yes/no
  publish(approved) -> url
  return url
}
```

`review` suspends the flow, persists state, and resumes on approval. On rejection it aborts the flow. This maps onto a human approval gate in any review-driven workflow. (`review` is implemented; the host decides approval, and the CLI prompts on a TTY, auto-approving when non-interactive.)

---

## 6. The type system and contracts (the verifiable spine)

### 6.1 What types do

Types catch the cheap, common mistakes before anything runs: passing a `list<text>` where a `Post` is expected, referencing a field that does not exist, a soft call whose declared return shape the runtime then enforces by coercing the model's output to it.

### 6.2 Contracts

- `require <bool-expr>` is a **precondition**, checked when a flow or step begins.
- `ensure <bool-expr>` is a **postcondition**, checked against a step's or flow's result.

Contracts are the bridge between "an AI produced this" and "I trust this." They turn a vibe into a checkable property.

### 6.3 The repair loop (why contracts are not just assertions)

This is the most important mechanic in the language. When an `ensure` on an agent step fails, the runtime does not immediately error. It **feeds the violated contract back to the agent as correction context and retries**, up to the agent's `retry` limit.

```weave
writer("...") -> draft
ensure draft.body.length <= 280
```

If the model returns 340 characters, the runtime re-invokes `writer` with: "Your previous output violated `draft.body.length <= 280` (was 340). Fix it." That is a self-correcting agent loop, expressed in two lines, with the guardrail and the fix mechanism unified. Only after exhausting retries does it hard-fail.

This is the concrete answer to "what makes a language for AI worthy." The language does not make the model smarter. It makes the model's mistakes cheap, visible, and automatically corrected. (Implemented in `src/interpreter.js`, `execBind`. The v0 demo shows it firing live: an over-long draft fails, gets fed back, and the retry passes.)

### 6.4 Honest limits of verification

Be clear-eyed: contracts check **structural and relational** properties, not semantic truth.

- Enforceable: length, format, membership in an enum, schema conformance, "a tool returned true," forbidden substrings, "every claim passed `fact_check`," references resolve, output parses.
- Not enforceable mechanically: "this prose is actually good," "this argument is sound." No type system can prove that. Judge contracts ([6.6](#66-judge-contracts-semantic-checks)) reach some of it with a model reviewer, but a judge is a strong heuristic, not a proof.

The honest framing is that a large share of real-world guardrails are structural, and those we enforce hard. Semantic quality is checked by a judge where it helps, and a human gate (`review`) still backs anything that truly matters. Weave does not pretend a model reviewer is the same as truth.

### 6.5 The contract fence (a hard rule, drawn early)

The line between "contracts in Weave" and "a second language embedded inside Weave" is fuzzy, and if left unguarded it creeps. So the fence is drawn now, before it is needed, and enforced by the checker, not merely documented.

A `require` or `ensure` expression may contain ONLY:

- literals, in-scope bindings, and member access (including `.length`)
- comparison operators (`==` `!=` `<` `>` `<=` `>=`) and boolean operators (`&&` `||` `not`)
- calls to a closed registry of predicates: built-in lints, or declared tools whose return type is `bool`

It may NOT contain lambdas, closures, function definitions, arithmetic, assignment, or calls to anything outside that registry. Ever.

Rationale: contracts must stay decidable, cheap, and obviously correct at a glance. The moment a contract can compute, it stops being a guardrail and becomes code that itself needs guarding. Predicates that need real logic live behind a `tool` or a built-in lint, where they are named, registered, and testable, not inline. The checker rejects any contract that breaches this fence (`src/checker.js`, `checkContract`).

### 6.6 Judge contracts (semantic checks)

Structural contracts cannot see whether copy is on-brand, specific, or sound. `judge` closes that gap without breaking the fence:

```weave
ensure judge(critic, "Specific and concrete, not generic fluff.", draft.body)
```

`judge(agentRef, rubric, value)` asks a reviewer agent whether the value meets the rubric and returns a bool, so it is still a registered predicate the fence allows. It is special in two ways: its first argument is an agent (not a value), and it is the one predicate that costs a model call and is non-deterministic.

The payoff is the repair loop. When a judge fails on a soft step, the reviewer's reason is fed back to the producing agent ("you broke this: <reason>, fix it"), so the model self-corrects toward quality, not just format. A failing structural contract gets the model under the length limit; a failing judge gets it on-brand.

Honest caveat: a judge is a model, so it is a strong heuristic, not a proof. Use a separate strict reviewer agent, keep rubrics narrow and binary, and keep a human `review` gate behind anything that truly matters.

---

## 7. Defeating the training-data objection, concretely

This section exists because it is the question that nearly sinks the whole idea, and the answer has to be mechanical, not hopeful.

**Mechanism 1: ship the language in the prompt.** The compiler has a `weave teach` command that emits the complete language spec plus curated few-shot examples as a single system-prompt pack. Because Weave is tiny (pillar 1), the whole thing fits in context. The model is not recalling Weave from training. It is reading a complete reference every time. Low-resource becomes a non-issue when the resource is in the prompt.

**Mechanism 2: constrain the decoding.** The formal grammar (Appendix A) compiles to a constrained-decoding grammar. For models that support grammar-constrained sampling (local models, some APIs), invalid Weave is literally unsamplable. For API models that do not, we fall back to parse-and-repair: generate, parse, and if it fails, return the parser error to the model and retry. Either way the output that leaves the system parses.

**Mechanism 3: embed in a host the model knows.** Soft-call prompt bodies are natural language, which models are excellent at. The structural scaffolding around them is what is constrained. So the model spends its fluency where it has fluency (the prompts) and the language handles the part the model is bad at (correct structure).

The net: the data gap is real, and we route around it three ways instead of denying it.

---

## 8. Execution model

### 8.1 Structure is deterministic, content is not

A flow's control flow, data dependencies, and contracts are fully deterministic. The only non-determinism is inside soft calls (model outputs). This separation is what makes flows debuggable.

### 8.2 Scheduling

Each `->` binding is a node. Edges are data dependencies (a step that reads `facts` depends on the step that produced `facts`). The runtime builds the DAG and runs independent nodes concurrently up to a concurrency cap. `parallel { }` is an explicit barrier for when you want to force and then join concurrency. (`parallel { }` is implemented and runs its binds concurrently; the implicit DAG auto-scheduler is v1.)

### 8.3 Retries and the repair loop

Per [6.3](#63-the-repair-loop-why-contracts-are-not-just-assertions). Agent-level `retry: N` sets the ceiling. Contract violations trigger feedback-and-retry. Tool failures use plain retry without feedback.

### 8.4 Caching

Soft calls and tool calls are content-addressed and memoized (hash of agent config + resolved prompt + inputs). Identical calls return cached results unless explicitly marked `fresh`. This keeps credit burn down and runs reproducible. (v0 caches within a single run; cross-run persistence is v1.)

### 8.5 Budgets

Agents and flows can carry a `budget:` in credits or dollars. Exceeding it halts the flow with a clear error rather than silently spending. Useful for capping cost in any budget-bound workflow.

### 8.6 Human gates

`review` suspends the flow, serializes its state, and resumes on an external approval signal. A suspended flow survives process restarts. Rejection aborts cleanly.

### 8.7 Memory semantics (sketch, so we are not cornered)

`agent { memory: ... }` takes one of three values. The load-bearing decision: memory is always **explicit and scoped**, never an implicit "dump everything into context" model that grows without bound.

- `none` (v0 default): stateless. Every soft call is independent. No transcript is retained.
- `session`: a per-flow-run transcript scoped to (run, agent). The agent's own prior calls within the same run are visible to it; nothing leaks across runs or across agents. Created when the run starts, discarded when it ends.
- `persistent`: a named store, host-backed (SQLite or a file), surviving across runs, keyed by (agent, key). It is read and written explicitly via built-ins (`mem.get(key)` / `mem.put(key, value)`), NOT auto-injected wholesale into the prompt. The agent pulls what it needs by key.

The commitment that keeps the architecture open: persistent memory is retrieval-by-key, not context-accretion. That avoids the unbounded-context failure mode and keeps runs reproducible, because a `persistent` read is a content-addressable input like any other. `none` and `session` are implemented; cross-run persistence ships as the `recall` / `remember` built-ins (retrieval-by-key), matching the commitment above.

### 8.8 Tool-use (the ReAct loop)

An agent that declares `tools: [...]` does not just carry them as metadata; on a soft call it can actually use them. Weave runs a ReAct loop: it offers the agent the tool signatures and a `CALL <tool> <json-args>` protocol, parses any tool call from the reply, runs the real Weave tool, feeds the result back, and loops until the agent stops. Then it makes the final typed completion using everything gathered.

This is implemented over plain text completion, so it works with the CLI backends, no API key and no native function-calling protocol required. The trade-off is that it is a text convention rather than structured tool-calling: more portable, a little less rigid. Calls to tools the agent did not declare are ignored, and agents with no `tools` stay one-shot. See `examples/research.weave`.

---

## 9. Architecture and compilation

```
source.weave
   |
   v
[ lexer ]      tokens
   |
   v
[ parser ]     AST
   |
   v
[ checker ]    types + contract fence + tool/agent resolution   (fails here = never runs)
   |
   v
[ interpret ]  v0: tree-walk the AST directly
[ codegen ]    v1: emit TypeScript targeting @weave/runtime
   |
   v
[ runtime ]    executes: model calls, MCP tools, CLIs, caching, retries, gates
```

- **Host language: TypeScript** (v0 is plain JS for zero build friction; TS port is planned). Your stack is TS-heavy (router, tools, Agent SDK). The runtime reuses what exists rather than rebuilding it.
- **Runtime backends:** Claude API, Gemini CLI, Magnific, Higgsfield, browser-harness, any MCP server, plain HTTP. A tool binding is just a function the runtime can call.
- **Two execution paths:**
  - v0: a tree-walking interpreter that executes the AST directly. Fastest route to a running program. (Built.)
  - v1+: codegen to standalone TS for portability and speed.

### 9.1 Tie-in to your world

- **Brief and spec documents can compile to flows.** Phases become stages with `review` gates, cost limits become a `budget`, scope locks become contracts. A spec stops being a document a person interprets and becomes a program that runs.
- **Tools are your existing integrations.** Nothing new to build to make Weave useful, just bindings.

---

## 10. Tooling

| Command | Does | Status |
|---|---|---|
| `weave run <file> [args]` | Type-check then execute a flow. | built |
| `weave check <file>` | Static check only (types, contract fence, resolution). No execution, no cost. | built |
| `weave teach [--examples]` | Emit the full in-context language pack for prompting a model to write Weave. | v1 |
| `weave grammar` | Emit the constrained-decoding grammar. | v1 |
| `weave trace <run-id>` | Replay a run: every step, every model call, every contract result. | v1 |
| `weave eval <suite>` | Run the eval harness (see [11](#11-the-eval-harness-the-research-artifact)). | v1 |

---

## 11. The eval harness (the research artifact)

This is where the "AI-written language" thesis gets tested honestly instead of asserted. The harness:

1. Takes a set of tasks with checkable success criteria.
2. Has a model produce a solution in Weave and an equivalent in raw TS/Python.
3. Measures, across many samples: parse rate, type-check pass rate, contract-pass rate, end-to-end task success, and cost.

The output is a **measured result**: "models produce contract-passing programs X percent more often in Weave than in raw TS, at Y cost." That is a finding worth publishing, and it is honest because the number could come back small. We report it either way. A null result here is still something nobody has measured.

---

## 12. v0 scope (BUILT)

v0 is implemented and runs. The goal was a real program executing end to end, not a complete language.

Built and working:

- Lexer + parser for the core grammar (`src/lexer.js`, `src/parser.js`).
- Checker with name resolution and the enforced contract fence (`src/checker.js`).
- Tree-walking interpreter with the repair loop (`src/interpreter.js`).
- Soft calls with structured-output shaping, against a deterministic mock backend (`src/models.js`) so runs cost nothing.
- `require` / `ensure`, `for`, `if`, built-in lints, in-run caching.
- A runnable example (`examples/demo.weave`).

Run it:

```
node src/cli.js check examples/demo.weave
node src/cli.js run   examples/demo.weave --topic "granite countertops"
```

Shipped since the first cut:

- Real model backends (Claude / Gemini via their CLIs, no API key).
- Judge contracts (semantic checks), tool-use (ReAct loop), `parallel`, `review` gates, budgets, and memory (`session` plus `recall` / `remember`).
- `weave teach` (the in-context language pack), an eval harness (`eval.mjs`), and editor syntax highlighting (`editor/`, a TextMate grammar).

Still deferred:

- Codegen to standalone TS (v0 interprets directly).
- Constrained-decoding grammar export, and a full language server (the TextMate grammar covers highlighting).
- npm publish: `files` / `bin` are prepared; the actual publish is a manual step.

---

## 13. Open questions

1. **Soft-call output coercion.** When a real model returns prose but the type is `Post`, how aggressive is coercion? Reask, parse-and-repair, or fail? Leaning parse-and-repair with a retry budget. (The mock backend sidesteps this; a real backend must solve it.)
2. **Tool binding format.** Config file, decorators in TS, or a manifest? Affects how easy it is to expose existing MCP tools.
3. **Determinism vs freshness.** Caching makes runs reproducible but agents sometimes need fresh data. Is a per-call `fresh` marker enough?
4. **Repair-loop attribution.** v0 attaches the contiguous `ensure`s after a soft bind to that step. Is contiguity the right rule, or should postconditions be grouped with their step explicitly?

Resolved since the first draft: contract expressiveness (now fixed by the fence, [6.5](#65-the-contract-fence-a-hard-rule-drawn-early)) and memory semantics (sketched, [8.7](#87-memory-semantics-sketch-so-we-are-not-cornered)).

---

## 14. Risks

- **The clean abstraction might not exist.** If orchestration patterns do not compress into clean syntax, Weave becomes a worse LangChain. Mitigation: real use surfaces this fast. If real pipelines do not map cleanly, stop.
- **The verifiability win might be marginal.** If most real guardrails turn out to be semantic (taste), contracts buy little. Mitigation: the eval harness measures this directly before we over-invest.
- **Constrained decoding may not be worth it for API models.** If parse-and-repair is good enough, the grammar export is lower priority. Mitigation: it is already deferred to v1.
- **Naming and prior art.** Resolved: the name is Weave (section 16), with `wandb/weave` as a neighbor to watch.

---

## 15. What this is honestly worth

Stripped of hype: Weave is not worthy because an AI writes it more fluently than Python. It does not. It is worthy because it is small enough that the AI does not need to have learned it, constrained enough that the AI cannot emit garbage, and strict enough that when the AI is wrong, you find out at line 12 instead of in production. The agent-DSL part gives you a tool that lives in your stack. The verifiability part gives you a thesis you can measure. Built together, the tool earns the thesis through real use instead of a whiteboard.

If that framing stops being true at any point during the build, the right move is to say so and stop, not to keep selling it.

---

## 16. Naming

Resolved: the name is **Weave**.

The earlier front-runner `Warp` was rejected after a check: the top GitHub `warp` is `warpdotdev/warp`, "an agentic development environment," a direct collision with this exact niche, plus npm `warp` and several large repos (seanmonstar/warp, NVIDIA/warp).

`Weave` availability (checked 2026-06-15):

- npm: bare `weave` is taken (`weave@0.15.1`). Public package is **`weave-lang`** (free).
- GitHub: repo is **`PythonLuvr/weave-lang`**. Notable neighbor is `wandb/weave` (an AI-app toolkit by Weights & Biases), adjacent (LLM eval/observability) but not an agent language.
- Source file extension: **`.weave`**.

The spoken/display name stays **Weave**. `weave-lang` is just the unique handle for the package and repo, where the bare name was unavailable.

---

## Appendix A: grammar sketch (EBNF)

```ebnf
program     = { decl } ;
decl        = typeDecl | toolDecl | agentDecl | flowDecl ;

typeDecl    = "type" ident "=" typeExpr ;
typeExpr    = recordType | unionType | listType | ident | stringLit ;
recordType  = "{" { ident ":" typeExpr } "}" ;
unionType   = typeExpr "|" typeExpr ;
listType    = "list" "<" typeExpr ">" ;

toolDecl    = "tool" ident "(" [ params ] ")" "->" typeExpr ;

agentDecl   = "agent" ident "{" { agentField } "}" ;
agentField  = ("model"   ":" ident)
            | ("tools"   ":" "[" [ identList ] "]")
            | ("memory"  ":" ("session" | "persistent" | "none"))
            | ("persona" ":" stringLit)
            | ("retry"   ":" intLit)
            | ("budget"  ":" budgetLit) ;

flowDecl    = "flow" ident "(" [ params ] ")" "->" typeExpr "{" { stmt } "}" ;
stmt        = bindStmt | requireStmt | ensureStmt
            | ifStmt | forStmt | parallelStmt | reviewStmt | returnStmt ;

bindStmt    = call "->" ident [ ":" typeExpr ] ;
requireStmt = "require" expr ;       (* expr restricted by the contract fence *)
ensureStmt  = "ensure"  expr ;       (* expr restricted by the contract fence *)
ifStmt      = "if" expr "{" { stmt } "}" [ "else" "{" { stmt } "}" ] ;
forStmt     = "for" ident "in" expr "{" { stmt } "}" ;
parallelStmt= "parallel" "{" { bindStmt } "}" ;     (* v1 *)
reviewStmt  = "review" expr "->" ident [ ":" typeExpr ] ;   (* v1 *)
returnStmt  = "return" expr ;

call        = ident "(" [ args ] ")" ;          (* agent soft call or tool call *)
expr        = literal | ident | call | member | binExpr | "(" expr ")" ;
member      = expr "." ident ;
binExpr     = expr binOp expr ;
binOp       = "==" | "!=" | "<=" | ">=" | "<" | ">" | "&&" | "||" ;

params      = param { "," param } ;
param       = ident ":" typeExpr ;
args        = expr { "," expr } ;
identList   = ident { "," ident } ;
```

Prompt templates inside soft calls use `{name}` interpolation against in-scope bindings.

## Appendix B: example programs

- `examples/demo.weave` runs in v0: `node src/cli.js run examples/demo.weave --topic "..."`.
- `examples/social_post.weave` layers a `review` gate on the demo flow. `examples/research.weave` (tool-use), `examples/judged-post.weave` (judge), and `examples/variants.weave` (parallel + review) show the rest.
