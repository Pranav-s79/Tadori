import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  findSymbolInputSchema,
  findSymbolOutputSchema,
  findTestsInputSchema,
  findTestsOutputSchema,
  impactInputSchema,
  impactOutputSchema,
  pathInputSchema,
  pathOutputSchema,
  repoOverviewInputSchema,
  repoOverviewOutputSchema,
  symbolContextInputSchema,
  symbolContextOutputSchema
} from "./contracts.js";
import type { TadoriTools } from "./tools.js";

function result(output: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output as Record<string, unknown>
  };
}

/** Registers the frozen public surface: exactly six tools, no resources or prompts. */
export function createTadoriMcpServer(tools: TadoriTools): McpServer {
  const server = new McpServer({ name: "tadori", version: "0.1.0" });

  server.registerTool(
    "repo_overview",
    {
      description: "Return bounded, evidence-backed structure for the active repository snapshot.",
      inputSchema: repoOverviewInputSchema,
      outputSchema: repoOverviewOutputSchema
    },
    (input) => result(tools.repoOverview(input))
  );
  server.registerTool(
    "find_symbol",
    {
      description: "Find exact and ranked symbol candidates without collapsing ambiguity.",
      inputSchema: findSymbolInputSchema,
      outputSchema: findSymbolOutputSchema
    },
    (input) => result(tools.findSymbol(input))
  );
  server.registerTool(
    "symbol_context",
    {
      description: "Return bounded structural context around one snapshot symbol.",
      inputSchema: symbolContextInputSchema,
      outputSchema: symbolContextOutputSchema
    },
    (input) => result(tools.symbolContext(input))
  );
  server.registerTool(
    "find_tests",
    {
      description: "Return likely relevant tests and their static linkage, never runtime coverage.",
      inputSchema: findTestsInputSchema,
      outputSchema: findTestsOutputSchema
    },
    (input) => result(tools.findTests(input))
  );
  server.registerTool(
    "impact",
    {
      description: "Return an evidence-backed reverse impact cone for symbols, files, or a diff.",
      inputSchema: impactInputSchema,
      outputSchema: impactOutputSchema
    },
    (input) => result(tools.impact(input))
  );
  server.registerTool(
    "path",
    {
      description: "Find directed, explainable graph paths between two snapshot entities.",
      inputSchema: pathInputSchema,
      outputSchema: pathOutputSchema
    },
    (input) => result(tools.path(input))
  );

  return server;
}
