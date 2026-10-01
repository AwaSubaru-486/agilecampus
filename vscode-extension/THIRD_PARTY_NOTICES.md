# VS Code extension third-party notices

| Package | Version | Purpose | License | Source |
| --- | --- | --- | --- | --- |
| `simple-git` | `4.0.2` | Read local Git root, commit SHA, branch, working-tree status, remotes, and recovery blockers for local checkpoints. | MIT | <https://github.com/steveukx/git-js> |
| `@bybrave/proper-lockfile2` | `5.0.0` | Keep worktree leases and local attempt updates mutually exclusive across extension-host processes, including safe stale-lock reclamation. | MIT | <https://github.com/bybraveHQ/proper-lockfile2> |
| `graceful-fs` | `4.2.11` | Filesystem compatibility layer used by the lock implementation. | ISC | <https://github.com/isaacs/node-graceful-fs> |
| `retry` | `0.13.1` | Retry scheduling used while acquiring a local attempt-record lock. | MIT | <https://github.com/tim-kos/node-retry> |
| `signal-exit` | `3.0.7` | Remove process-owned local locks during normal process exit. | ISC | <https://github.com/tapjs/signal-exit> |

Runtime package versions resolve from this extension's `package-lock.json`. `simple-git` invokes the installed Git executable; it does not bundle Git or access remotes. Only fixed Git queries are used by the repository service.
