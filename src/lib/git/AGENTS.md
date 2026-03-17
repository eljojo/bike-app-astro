# Git Operations (`src/lib/git/`)

Git read/write operations for the content data repo. Two adapters share the `IGitService` interface: `GitService` uses the GitHub REST API in production, `LocalGitService` uses `simple-git` on the local filesystem. The factory selects based on `RUNTIME` env var.

## Files

| File | Role |
|------|------|
| `git.adapter-github.ts` | GitHub REST API adapter. Exports `IGitService` interface, `GitService` class, `computeBlobSha`, base64 helpers, `FileChange`/`CommitAuthor`/`CommitInfo` types |
| `git.adapter-local.ts` | Local filesystem adapter using `simple-git`. Module-level write mutex prevents concurrent writes |
| `git-factory.ts` | `createGitService()` — selects adapter based on `RUNTIME` env var |
| `git-lfs.ts` | Git LFS Batch API — uploads content to GitHub's LFS storage, returns pointer file text. Used for GPX files in production |
| `git-gpx.ts` | `commitGpxFile()` — wraps LFS upload (prod) vs raw content (local) for GPX commits |
| `git-utils.ts` | `computeBlobSha()` — computes SHA-1 blob hash matching `git hash-object` format |
| `commit-author.ts` | Author email encoding (`username+userId@whereto.bike`), commit message parsing (`Changes:` trailer, content path extraction) |

## Gotchas

- **Vendor isolation boundary**: `git-factory.ts` is one of the five adapter boundary points. Only this file checks `RUNTIME`.
- **LFS is production-only**: locally, `.gitattributes` handles LFS. `git-gpx.ts` returns raw GPX content when no `GITHUB_TOKEN` is present.
- **`computeBlobSha`** is re-exported from both `git-utils.ts` and `git.adapter-github.ts`. The canonical definition lives in `git-utils.ts`.
- **Single-file vs multi-file commits**: `writeFiles` uses the simpler Contents API for single files, the Git Trees API for multi-file atomic commits or deletions.
- **Author email format**: `username+userId@whereto.bike` encodes the user ID for later lookup. Old format (`username@whereto.bike`) is also parsed.

## Cross-References

- Save pipeline: `src/lib/content/content-save.ts` creates git services via the factory
- Commit author: `commit-author.ts` is used by content-save and the admin history viewer
- LFS: `git-lfs.ts` is only called from `git-gpx.ts`
