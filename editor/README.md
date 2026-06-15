# Weave syntax highlighting

A TextMate grammar for `.weave` files, usable as a VS Code extension.

## Try it locally

Copy this `editor/` folder into `%USERPROFILE%\.vscode\extensions\weave-lang-syntax`
(or `~/.vscode/extensions/...`) and reload VS Code. Open any `.weave` file.

The grammar (`weave.tmLanguage.json`) is editor-agnostic; any TextMate-compatible
editor can use it.

## Language server (diagnostics, completion, hover)

Weave ships a language server at `src/lsp.js` (LSP over stdio, zero dependencies):
live error squiggles from the checker, completion for keywords / built-ins /
declared names, and hover. Start it with `weave lsp` (or `node src/lsp.js`) and
point any LSP client at that command for the `weave` language. Neovim example:

    vim.lsp.start({ name = 'weave', cmd = { 'node', '/abs/path/weave-lang/src/lsp.js' }, filetypes = { 'weave' } })

A VS Code client wrapper (vscode-languageclient) is a follow-up; the server is
editor-agnostic.
