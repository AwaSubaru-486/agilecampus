# Third-party implementation notices

## Lody session tree adaptation

`src/lib/conversation-tree.ts` adapts the defensive tree-building rules from
[`LodyAI/Lody`](https://github.com/LodyAI/Lody), licensed under the Apache
License 2.0. The original project separates session containment from creation
provenance and safely handles missing parents, cycles, stable ordering, and
collapsed children. AgileCampus uses the same ideas for project conversation
branches, with its own types, API contract, tests, and UI.

This notice does not imply that the Lody desktop client, daemon, ACP runtime,
or hosted services are included in AgileCampus.

## Other references

The product and interaction design also references the public projects listed
in `docs/ai-collaboration.md`. Their code is not bundled unless a separate
notice is added for a specific adapted implementation.
