// teach.js
// The in-context language pack. `weave teach` prints this so you can paste the
// whole of Weave into a model's prompt and have it author valid programs. The
// language is small on purpose: the entire reference fits in a prompt, which is
// how a brand-new language sidesteps the no-training-data problem.

export const teachPack = `# Weave, complete reference

Weave is a small language for orchestrating AI agents. You write a typed
pipeline (a flow). It calls agents (models) and tools (real functions), and
contracts check every result. A failing contract is fed back to the model,
which retries until it passes. Output your answer as a single .weave program,
no prose, no markdown fences.

## Five concepts
- type   : a data shape (record, list, union of string literals, primitives).
- tool   : a typed binding to a real function. Signature only.
- agent  : a configured model caller (model, persona, tools, retry, budget, memory).
- flow   : the program. Typed params and return, a body of steps, contracts.
- soft call : calling an agent with a prompt string; returns a typed value.

## Types
  type Topic = text
  type Mood  = "good" | "bad" | "ok"          // enum = union of string literals
  type Post  = { headline: text  body: text  cta: text }   // record
  list<text>                                  // list type
  primitives: text, int, num, bool

## Declarations
  tool web_search(query: text) -> list<text>
  tool fact_check(claim: text) -> bool
  agent writer { model: claude  persona: "..."  retry: 3  tools: [web_search]  memory: session  budget: 8 }

## Flow and steps
  flow name(param: Type) -> ReturnType {
    require <bool-expr>                  // precondition
    agent_or_tool(args) -> name: Type    // bind a step result to a name
    for x in listExpr { ... }            // loop
    if cond { ... } else { ... }         // branch (flat scope: binds stay visible after)
    parallel { a(...) -> x  b(...) -> y } // run binds concurrently
    review value -> approved: Type        // human approval gate
    ensure <bool-expr>                    // postcondition (checked, then repaired)
    return <expr>
  }
  // prompt strings interpolate in-scope names: "write about {topic}"

## Contracts (the fence)
require / ensure may ONLY use: literals, in-scope names, member access (a.b, .length),
comparisons (== != < > <= >=), boolean ops (&& || not), and calls to:
  - built-in lints: contains(t,sub), starts_with, ends_with, no_em_dashes(t), no_hashtags(t)
  - declared tools that return bool
  - judge(agentRef, "rubric", value)  -> a reviewer agent checks semantic quality
No lambdas, no arithmetic, no other calls. A failed ensure on a soft step is fed
back to the agent with the reason, and it retries (up to retry).

## Memory and tools
- agent with tools: [...] can call them in a ReAct loop during a soft call.
- agent memory: session  -> remembers earlier turns this run.
- remember("key", value) -> bool ; recall("key") -> text   // persistent key-value

## Example
  type Post = { body: text  cta: text }
  agent writer { model: claude  persona: "Brand copywriter. No em dashes."  retry: 3 }
  agent critic { model: claude }
  flow topic_to_post(topic: text) -> Post {
    require topic != ""
    writer("Write a post about {topic}") -> draft: Post
    ensure draft.body.length <= 280
    ensure draft.cta != ""
    ensure no_em_dashes(draft.body)
    ensure judge(critic, "Specific and on-brand, not generic.", draft.body)
    return draft
  }

Now write a .weave program for the task you are given.`;
