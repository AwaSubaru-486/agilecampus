export type GitHubLinkKind = "repository" | "issue" | "pull_request" | "actions_run" | "commit";

export type GitHubLink = {
  kind: GitHubLinkKind;
  owner: string;
  repo: string;
  number?: number;
  runId?: number;
  url: string;
};

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

function numeric(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Recognises GitHub URLs that can be shown as project evidence. Unsupported
 * paths return null so arbitrary GitHub pages do not silently become evidence.
 */
export function parseGitHubLink(input: string): GitHubLink | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || !GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, repo, resource, value, maybeRun, runValue] = segments;
  if (!owner || !repo || owner === "." || repo === ".") return null;

  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (!resource) return { kind: "repository", owner, repo, url: base };

  if (resource === "issues" || resource === "pull") {
    const number = numeric(value);
    if (number === undefined) return null;
    return {
      kind: resource === "issues" ? "issue" : "pull_request",
      owner,
      repo,
      number,
      url: `${base}/${resource}/${number}`,
    };
  }

  if (resource === "commit" && value) {
    return { kind: "commit", owner, repo, url: `${base}/commit/${encodeURIComponent(value)}` };
  }

  if (resource === "actions" && value === "runs") {
    const runId = numeric(maybeRun);
    if (runId === undefined || runValue !== undefined) return null;
    return { kind: "actions_run", owner, repo, runId, url: `${base}/actions/runs/${runId}` };
  }

  return null;
}

export function githubLinkLabel(link: GitHubLink): string {
  const prefix = `${link.owner}/${link.repo}`;
  if (link.kind === "repository") return prefix;
  if (link.kind === "issue") return `${prefix} · Issue #${link.number}`;
  if (link.kind === "pull_request") return `${prefix} · PR #${link.number}`;
  if (link.kind === "actions_run") return `${prefix} · Actions #${link.runId}`;
  return `${prefix} · Commit ${link.url.split("/").pop()}`;
}
