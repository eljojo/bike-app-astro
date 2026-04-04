# Git Operations (`src/lib/git/`)

Git read/write for the content data repo. Two adapters sharing `IGitService`: GitHub REST API (prod) and `simple-git` (local).

## Files

| File | Role |
|------|------|
| `git.adapter-github.ts` | GitHub REST API adapter. Exports `IGitService`, `GitService`, `FileChange`/`CommitAuthor` types |
| `git.adapter-local.ts` | Local filesystem adapter using `simple-git`. Module-level write mutex |
| `git-factory.ts` | `createGitService()` — selects adapter based on `RUNTIME` |
| `git-lfs.ts` | Git LFS Batch API — uploads to GitHub LFS, returns pointer file text |
| `git-gpx.ts` | `commitGpxFile()` — LFS upload (prod) vs raw content (local) |
| `git-utils.ts` | `computeBlobSha()` — SHA-1 hash matching `git hash-object` format |
| `commit-author.ts` | Author email encoding (`username+userId@whereto.bike`), commit message parsing |

## Gotchas

- **Vendor isolation boundary**: `git-factory.ts` is one of the adapter boundary points. Only this file checks `RUNTIME`.
- **LFS is production-only**: locally, `.gitattributes` handles LFS.
- **`computeBlobSha`** canonical definition is in `git-utils.ts` (re-exported elsewhere).
- **Single vs multi-file commits**: `writeFiles` uses Contents API for single files, Git Trees API for multi-file.

## Detailed Context

- [Vendor isolation](../../../_ctx/vendor-isolation.md)
