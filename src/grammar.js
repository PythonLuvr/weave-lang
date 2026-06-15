// grammar.js
// A GBNF grammar (llama.cpp / grammar-constrained sampling format) for Weave.
// `weave grammar` prints it. Feed it to a backend that supports grammar-
// constrained decoding (local models via llama.cpp / vLLM, some APIs) and the
// model can only emit syntactically valid Weave, parse-rate 100% by construction.
//
// This is the mechanical form of design pillar 3. It is a best-effort grammar:
// it constrains structure; the checker still enforces the contract fence and
// name resolution, which a context-free grammar cannot express.

export const gbnf = String.raw`
root      ::= ws decl (ws decl)* ws
decl      ::= typedecl | tooldecl | agentdecl | flowdecl

typedecl  ::= "type" ws ident ws "=" ws type
tooldecl  ::= "tool" ws ident ws "(" ws params? ws ")" ws "->" ws type
agentdecl ::= "agent" ws ident ws "{" ws field* "}"
flowdecl  ::= "flow" ws ident ws "(" ws params? ws ")" ws "->" ws type ws "{" ws stmt* "}"

field     ::= ident ws ":" ws fieldval ws
fieldval  ::= string | number | ident | "[" ws (ident (ws "," ws ident)*)? ws "]"

params    ::= param (ws "," ws param)*
param     ::= ident ws ":" ws type

type      ::= "list" ws "<" ws type ws ">" | record | string (ws "|" ws string)* | ident
record    ::= "{" ws (ident ws ":" ws type ws)* "}"

stmt      ::= (require | ensure | reviewst | parallelst | forst | ifst | returnst | bind | exprst) ws
require   ::= "require" ws expr
ensure    ::= "ensure" ws expr
returnst  ::= "return" ws expr
reviewst  ::= "review" ws expr ws "->" ws ident (ws ":" ws type)?
parallelst::= "parallel" ws "{" ws (bind ws)* "}"
forst     ::= "for" ws ident ws "in" ws expr ws "{" ws stmt* "}"
ifst      ::= "if" ws expr ws "{" ws stmt* "}" (ws "else" ws "{" ws stmt* "}")?
bind      ::= call ws "->" ws ident (ws ":" ws type)?
exprst    ::= expr

expr      ::= orexpr
orexpr    ::= andexpr (ws ("||" | "&&") ws andexpr)*
andexpr   ::= cmpexpr (ws ("==" | "!=" | "<=" | ">=" | "<" | ">") ws cmpexpr)*
cmpexpr   ::= ("not" ws)? postfix
postfix   ::= primary (("." ident) | (ws "(" ws args? ws ")"))*
primary   ::= string | number | "true" | "false" | ident | "(" ws expr ws ")"
call      ::= ident ws "(" ws args? ws ")"
args      ::= expr (ws "," ws expr)*

ident     ::= [a-zA-Z_] [a-zA-Z0-9_]*
string    ::= "\"" ([^"\\] | "\\" .)* "\""
number    ::= [0-9]+ ("." [0-9]+)?
comment   ::= "//" [^\n]* "\n"
ws        ::= ([ \t\r\n] | comment)*
`.trim() + '\n';
