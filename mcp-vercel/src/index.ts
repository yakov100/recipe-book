/**
 * MCP Server for Vercel API
 * Tools: list_projects, list_deployments, get_deployment, get_deployment_events, get_project, cancel_deployment
 *
 * Requires: VERCEL_TOKEN env (create at https://vercel.com/account/tokens)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const VERCEL_API = "https://api.vercel.com";

function getToken(): string {
  const t = process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN;
  if (!t) {
    throw new Error(
      "VERCEL_TOKEN or VERCEL_ACCESS_TOKEN is required. Create one at https://vercel.com/account/tokens"
    );
  }
  return t;
}

async function vercelFetch(
  path: string,
  opts: { method?: string; teamId?: string; slug?: string; params?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
  const token = getToken();
  const url = new URL(path.startsWith("http") ? path : `${VERCEL_API}${path}`);
  if (opts.params) {
    Object.entries(opts.params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  if (opts.teamId) url.searchParams.set("teamId", opts.teamId);
  if (opts.slug) url.searchParams.set("slug", opts.slug);

  const res = await fetch(url.toString(), {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  return res;
}

const server = new McpServer({
  name: "vercel",
  version: "1.0.0",
});

// --- list_projects
server.tool(
  "list_projects",
  "List all Vercel projects for the authenticated user or team",
  {
    teamId: z.string().optional().describe("Team ID"),
    slug: z.string().optional().describe("Team slug"),
    search: z.string().optional().describe("Search by project name"),
    limit: z.number().optional().describe("Max projects to return (default 20)"),
  },
  async ({ teamId, slug, search, limit }) => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (limit != null) params.limit = String(limit);
      const res = await vercelFetch("/v10/projects", { teamId, slug, params });
      const data = (await res.json()) as { projects?: unknown[] } | unknown[];
      const list = Array.isArray(data) ? data : (data as { projects?: unknown[] }).projects ?? [];
      const text = JSON.stringify(list, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  }
);

// --- list_deployments
server.tool(
  "list_deployments",
  "List deployments, optionally filtered by projectId, target (production/preview), or state",
  {
    projectId: z.string().optional().describe("Filter by project ID or name"),
    teamId: z.string().optional().describe("Team ID"),
    slug: z.string().optional().describe("Team slug"),
    target: z.enum(["production", "preview"]).optional().describe("production or preview"),
    state: z.string().optional().describe("BUILDING, READY, ERROR, QUEUED, INITIALIZING, CANCELED (comma-sep)"),
    limit: z.number().optional().describe("Max deployments (default 20)"),
  },
  async ({ projectId, teamId, slug, target, state, limit }) => {
    try {
      const params: Record<string, string> = {};
      if (projectId) params.projectId = projectId;
      if (target) params.target = target;
      if (state) params.state = state;
      if (limit != null) params.limit = String(limit);
      const res = await vercelFetch("/v6/deployments", { teamId, slug, params });
      const data = (await res.json()) as { deployments?: unknown[]; pagination?: unknown };
      const list = (data as { deployments?: unknown[] }).deployments ?? [];
      const text = JSON.stringify({ deployments: list, pagination: (data as { pagination?: unknown }).pagination }, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  }
);

// --- get_deployment
server.tool(
  "get_deployment",
  "Get deployment details by ID or URL (e.g. dpl_xxx or xxx.vercel.app)",
  {
    idOrUrl: z.string().describe("Deployment ID (dpl_xxx) or hostname/URL"),
    teamId: z.string().optional().describe("Team ID"),
    slug: z.string().optional().describe("Team slug"),
  },
  async ({ idOrUrl, teamId, slug }) => {
    try {
      const res = await vercelFetch(`/v13/deployments/${encodeURIComponent(idOrUrl)}`, { teamId, slug });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  }
);

// --- get_deployment_events (build logs)
server.tool(
  "get_deployment_events",
  "Get build logs/events for a deployment. Use builds=1 and limit to get recent logs.",
  {
    idOrUrl: z.string().describe("Deployment ID or URL"),
    teamId: z.string().optional().describe("Team ID"),
    slug: z.string().optional().describe("Team slug"),
    builds: z.union([z.literal(0), z.literal(1)]).optional().describe("1 to include build logs (default 1)"),
    limit: z.number().optional().describe("Max events (default 100, -1 for all)"),
    direction: z.enum(["forward", "backward"]).optional().describe("Order by time (default: forward)"),
  },
  async ({ idOrUrl, teamId, slug, builds = 1, limit = 100, direction }) => {
    try {
      const params: Record<string, string> = { builds: String(builds) };
      if (limit != null) params.limit = String(limit);
      if (direction) params.direction = direction;
      const res = await vercelFetch(`/v3/deployments/${encodeURIComponent(idOrUrl)}/events`, {
        teamId,
        slug,
        params,
      });
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      // Summarize for readability: extract 'text' from payload when present
      const lines = arr.map((e: { type?: string; created?: number; payload?: { text?: string } }) => {
        const t = e.payload?.text ?? "";
        return t ? `[${e.type}] ${t}` : `[${e.type}] ${JSON.stringify(e.payload ?? {})}`;
      });
      const text = lines.length ? lines.join("\n") : JSON.stringify(arr, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  }
);

// --- get_project
server.tool(
  "get_project",
  "Get a single project by ID or name",
  {
    idOrName: z.string().describe("Project ID or name"),
    teamId: z.string().optional().describe("Team ID"),
    slug: z.string().optional().describe("Team slug"),
  },
  async ({ idOrName, teamId, slug }) => {
    try {
      const res = await vercelFetch(`/v9/projects/${encodeURIComponent(idOrName)}`, { teamId, slug });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  }
);

// --- cancel_deployment
server.tool(
  "cancel_deployment",
  "Cancel a deployment that is currently building or queued",
  {
    id: z.string().describe("Deployment ID (dpl_xxx)"),
    teamId: z.string().optional().describe("Team ID"),
    slug: z.string().optional().describe("Team slug"),
  },
  async ({ id, teamId, slug }) => {
    try {
      const res = await vercelFetch(`/v12/deployments/${encodeURIComponent(id)}/cancel`, {
        method: "PATCH",
        teamId,
        slug,
      });
      const data = await res.json();
      return {
        content: [
          {
            type: "text",
            text: res.ok
              ? `Deployment ${id} canceled.\n${JSON.stringify(data, null, 2)}`
              : `Request failed (${res.status}): ${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Vercel MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
