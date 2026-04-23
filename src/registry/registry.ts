import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RegistrySchema, type Registry, type Surface, type Subreddit, type Competitor } from "../models/surface.js";

const REGISTRY_PATH = resolve(import.meta.dirname, "../../surfaces.json");

export function loadRegistry(): Registry {
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  const data = JSON.parse(raw);
  return RegistrySchema.parse(data);
}

export interface SelectOptions {
  type?: "permanent" | "rotating";
  ids?: string[];
  maxTier?: 1 | 2 | 3;
}

export function selectSurfaces(registry: Registry, options?: SelectOptions): Surface[] {
  let surfaces = [...registry.surfaces];

  if (options?.type) {
    surfaces = surfaces.filter((s) => s.type === options.type);
  }
  if (options?.ids?.length) {
    const idSet = new Set(options.ids);
    surfaces = surfaces.filter((s) => idSet.has(s.id));
  }
  if (options?.maxTier) {
    surfaces = surfaces.filter((s) => s.tier <= options.maxTier!);
  }

  return surfaces.sort((a, b) => a.tier - b.tier);
}

export function getSubredditsForSurface(registry: Registry, surfaceId: string): Subreddit[] {
  return registry.subreddits.filter((sub) => sub.surface_ids.includes(surfaceId));
}

export function getCompetitorsForSurface(registry: Registry, surfaceId: string): Competitor[] {
  return registry.competitors.filter((c) => c.surface_ids.includes(surfaceId));
}
