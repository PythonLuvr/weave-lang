// tools.js
// The default tool registry: generic stubs so the bundled examples run with no
// external dependencies. Real deployments bind their own tools (MCP servers,
// CLIs, HTTP calls, plain functions) by passing a module to the CLI:
//
//   weave run flow.weave --tools ./my-tools.mjs
//
// where the module exports a createTools() returning { name: async fn, ... }.

export function createTools() {
  return {
    web_search: async (query) => [`Result for: ${query}`, `Another result for: ${query}`],
    fact_check: async (_claim) => true,
    publish: async (_post) => 'https://example.com/posts/123',
  };
}
