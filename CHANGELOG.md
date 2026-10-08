# Changelog

All notable changes to **Trinno Research Assist** are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-10-08

### Changed
- **Breaking:** AI tools now use the ezbos 2.x typed contract. A failed tool
  call returns `err(...)` / `{ success: false, error }` and is surfaced to the
  model as a tool error; previously some failures came back as `{ ok: false }`
  or a bare `Error:` string and were reported as completed calls.
- **Breaking:** contradiction lookups now return the verified canonical
  Altshuller recommendations. Many parameter pairs that previously read the
  wrong column — or silently returned nothing — now return a different
  (correct) set of principles.
- **Breaking:** a slash command typed while a response is streaming is queued
  instead of interrupting the stream. Only `/session` and `/new` act
  immediately.

### Security
- Stop logging the full API key in plaintext on every chat request (#6).
- Reject directory traversal in `loadLocalSkill`, and stop `papers_download`
  from escaping the workspace guard (#7).
- Escape user-supplied labels in generated S-curve SVGs (stored XSS) (#8).

### Added
- `contradiction-matrix` test suite covering row shape, principle ranges,
  blank cells and canonical values; `npm run test:tools` runs it.

### Fixed
- Rebuilt the 39×39 contradiction matrix from cross-verified sources
  (623 populated cells) and removed the override table that shadowed real
  cells, so lookups no longer read the wrong column (#3).
- Chat no longer hangs when the worker exits mid-request or reports
  rate-limited — the dispatch slot is always released (#4).
- Slash dispatch survives cancellation: each command gets a fresh abort signal,
  every failure emits an error payload, and the abort listener no longer leaks
  (#5).
- Deleting the active session no longer resurrects the deleted file on disk
  (#9).
- Panel: auto-compact failures no longer leave the chat stuck in "generating",
  and `/recover` tolerates histories whose messages have no reasoning field
  (#10).
- HTTP client: body reads have a deadline and honour cancellation, retries
  actually fire on self-timeout and 429/5xx, the cookie jar works in the
  default mode, and multi-source search requests time out instead of hanging
  (#11).
- Paper downloader: non-2xx responses are treated as errors, buffer magic beats
  Content-Type, EPUB/ZIP downloads keep the right extension, `&`-entities in
  links are decoded, and duplicate filenames are written without a race (#12).
- Worker/slash robustness: user skill directories can no longer shadow built-in
  commands, the slash path initialises the model like chat does, `/auto`
  honours cancellation, `/contradiction` cannot hang on cancel, `/undo`
  survives a restart, and `/s-curve` rejects out-of-range TRL (#14).
- Assorted fixes: `set-workspace` no longer consumes the dispatch slot, coding
  tools report spawn failures, raw-facts filenames are Windows-safe,
  `/download` help points at the right directory, dead code removed, and panel
  listeners are registered once (#15).
