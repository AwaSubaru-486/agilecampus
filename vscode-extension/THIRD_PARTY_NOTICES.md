# VS Code extension third-party notices

| Package | Version | Purpose | License | Source |
| --- | --- | --- | --- | --- |
| `simple-git` | `4.0.2` | Read local Git root, commit SHA, branch, working-tree status, remotes, and recovery blockers for local checkpoints. | MIT | <https://github.com/steveukx/git-js> |

`simple-git` invokes the installed Git executable; it does not bundle Git or access remotes. Attempt coordination also uses that installed Git executable's local `update-ref` compare-and-swap operation inside the extension's private global-storage directory. It does not access a remote or alter the user's project refs.
