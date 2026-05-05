import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultSuccess, McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

interface AgentConfig {
  model?: string | null;
  prompt_file?: string | null;
  server_name?: string | null;
  tools?: string[];
  builtin_tools?: string[];
  max_turns?: number;
  skills?: string[];
}

function loadConfig(agentId: string): AgentConfig {
  const configPath = resolve(ROOT, "content/pipelines/twitter-news/agents", agentId, "config.json");
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfig;
}

function loadSystemMd(agentId: string): string {
  const path = resolve(ROOT, "content/pipelines/twitter-news/agents", agentId, "system.md");
  return readFileSync(path, "utf-8");
}

function loadPromptFile(promptFilePath: string): string {
  const absPath = resolve(ROOT, promptFilePath);
  if (!existsSync(absPath)) {
    throw new Error(`Agent prompt_file not found: ${absPath}`);
  }
  return readFileSync(absPath, "utf-8").trim();
}

function validateSkills(agentId: string, skills: string[]): void {
  for (const skillDir of skills) {
    const skillPath = resolve(ROOT, skillDir, "SKILL.md");
    if (!existsSync(skillPath)) {
      throw new Error(
        `Agent "${agentId}" references skill "${skillDir}" but SKILL.md not found at: ${skillPath}`,
      );
    }
  }
}

/**
 * Generic agent runner. Loads system.md as the system prompt, pre-loads the
 * prompt file from config and injects it into the user turn, then passes the
 * dynamic data. The agent can still read skill files at runtime via Read.
 *
 * @param opts.agentId   - Agent folder name under content/pipelines/twitter-news/agents/
 * @param opts.prompt    - Dynamic data for this run (stories, items, etc.)
 * @param opts.mcpServer - SDK MCP server providing the agent's tools
 * @param opts.model     - Override the model from config
 * @param opts.maxTurns  - Override max agentic turns from config
 * @param opts.addDirs   - Additional directories to make accessible (e.g. media dir)
 */
export async function runAgent(opts: {
  agentId: string;
  prompt: string;
  mcpServer?: McpSdkServerConfigWithInstance;
  model?: string;
  maxTurns?: number;
  addDirs?: string[];
}): Promise<string> {
  const { agentId, prompt, mcpServer, addDirs = [] } = opts;

  const config = loadConfig(agentId);

  // Validate skill paths at startup — catches renames before the agent runs
  if (config.skills?.length) {
    validateSkills(agentId, config.skills);
  }

  const model = opts.model ?? (config.model ?? undefined);

  // System prompt: agent identity from system.md
  const systemPrompt = loadSystemMd(agentId).trim();

  // Pre-load prompt file and inject into user turn — saves one agent turn,
  // catches path errors at startup. Skills are still read dynamically by the agent.
  const workflowContent = config.prompt_file ? loadPromptFile(config.prompt_file) : null;
  const userTurn = workflowContent
    ? `<workflow>\n${workflowContent}\n</workflow>\n\n${prompt}`
    : prompt;

  // MCP tools: server name and tool list come from config
  const serverName = config.server_name ?? undefined;
  const toolNames = config.tools ?? [];
  const builtinTools = config.builtin_tools ?? ["Read"];
  const maxTurns = opts.maxTurns ?? config.max_turns ?? 15;

  const mcpToolNames = serverName
    ? toolNames.map((n) => `mcp__${serverName}__${n}`)
    : [];
  const allAllowedTools = [...new Set([...builtinTools, ...mcpToolNames])];

  const agentDef = {
    description: `${agentId} agent`,
    prompt: systemPrompt,
    ...(mcpToolNames.length > 0 ? { tools: mcpToolNames } : {}),
    ...(model ? { model } : {}),
  };

  for await (const msg of query({
    prompt: userTurn,
    options: {
      agent: agentId,
      agents: { [agentId]: agentDef },
      ...(mcpServer && serverName
        ? { mcpServers: { [serverName]: mcpServer } }
        : {}),
      allowedTools: allAllowedTools,
      tools: allAllowedTools,
      maxTurns,
      persistSession: false,
      additionalDirectories: addDirs,
    },
  })) {
    if (msg.type === "result") {
      if (msg.is_error) {
        const subtype = (msg as { subtype?: string }).subtype ?? "unknown";
        throw new Error(`Agent ${agentId} error: ${subtype}`);
      }
      return (msg as SDKResultSuccess).result;
    }
  }

  throw new Error(`No result message received from agent ${agentId}`);
}
