import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultSuccess, McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

interface AgentConfig {
  model?: string | null;
  skills?: Record<string, string>;
  prompt_file?: string | null;
}

function loadConfig(agentId: string): AgentConfig {
  const configPath = resolve(ROOT, "agents", agentId, "config.json");
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfig;
}

function loadPromptFile(filePath: string): string {
  return readFileSync(resolve(ROOT, filePath), "utf-8");
}

function loadSkillContent(skillPath: string): string {
  return readFileSync(resolve(ROOT, skillPath), "utf-8");
}

/**
 * Generic agent runner. Builds a system prompt from the agent's config and
 * prompt_file (injecting skill content), then calls Claude via the Agent SDK
 * with the provided MCP server and tool restrictions.
 *
 * @param opts.agentId   - Agent folder name under agents/
 * @param opts.prompt    - User message (dynamic data — items, stories, thread, etc.)
 * @param opts.mcpServer - SDK MCP server with the tools Claude can call
 * @param opts.serverName - Key for the MCP server in the mcpServers map
 * @param opts.toolNames  - Short tool names (without mcp__ prefix)
 * @param opts.skillKey   - Key in config.skills to inject into system prompt
 * @param opts.model      - Override model from config
 * @param opts.maxTurns   - Max agentic turns (default: 15)
 */
export async function runAgent(opts: {
  agentId: string;
  prompt: string;
  mcpServer?: McpSdkServerConfigWithInstance;
  serverName?: string;
  toolNames?: string[];
  skillOverrides?: Record<string, string>;
  model?: string;
  maxTurns?: number;
}): Promise<string> {
  const {
    agentId,
    prompt,
    mcpServer,
    serverName,
    toolNames = [],
    skillOverrides,
    maxTurns = 15,
  } = opts;

  const config = loadConfig(agentId);
  const model = opts.model ?? (config.model ?? undefined);

  // Build system prompt: prompt_file + optional skill injection
  let systemPrompt = "";
  if (config.prompt_file) {
    let raw = loadPromptFile(config.prompt_file);
    // Named skill placeholders: {{skill_<key>}} → content of config.skills[key] or skillOverrides[key]
    const allSkills = { ...config.skills, ...(skillOverrides ?? {}) };
    for (const [key, path] of Object.entries(allSkills)) {
      if (typeof path === "string") {
        raw = raw.replace(
          new RegExp(`\\{\\{skill_${key}\\}\\}`, "g"),
          loadSkillContent(path),
        );
      }
    }
    // Strip any remaining unreplaced placeholders so the system prompt is clean
    raw = raw.replace(/\{\{\w+\}\}/g, "");
    systemPrompt = raw.trim();
  }

  // MCP tool names as Claude sees them: mcp__<server>__<tool>
  const mcpToolNames = serverName
    ? toolNames.map((n) => `mcp__${serverName}__${n}`)
    : toolNames;

  const agentDef = {
    description: `${agentId} agent`,
    prompt: systemPrompt,
    ...(mcpToolNames.length > 0 ? { tools: mcpToolNames } : {}),
    ...(model ? { model } : {}),
  };

  for await (const msg of query({
    prompt,
    options: {
      agent: agentId,
      agents: { [agentId]: agentDef },
      ...(mcpServer && serverName
        ? { mcpServers: { [serverName]: mcpServer } }
        : {}),
      allowedTools: mcpToolNames,
      tools: [],
      maxTurns,
      persistSession: false,
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
