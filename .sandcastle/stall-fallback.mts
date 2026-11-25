import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";
import type { Strike } from "./ticket-ledger.mjs";

/**
 * Cloud authors: a cloud model that writes tickets, either as the factory's
 * author model or as the fallback that takes over a ticket the local model
 * could not finish inside the ticket budget.
 *
 * It is the one case where a provider credential enters a sandbox, by the
 * owner's decision, so everything here is narrow on purpose. With a local
 * author model, only a ticket with a `stalled` strike gets a cloud author and
 * only that ticket's sandbox receives a credential. With a cloud author model
 * every sandbox does, because every one runs that model. Either way the
 * credentials are those of the configured cloud providers, never the host's
 * OpenCode auth store, and a ticket is never reviewed by the model that wrote it.
 */

/** The providers a fallback author may use, and how each one's credential travels. */
export const FALLBACK_PROVIDERS = ["opencode-go", "ollama-cloud"] as const;
export type FallbackProvider = (typeof FALLBACK_PROVIDERS)[number];

/** Where the owner keeps the OpenCode Go key on the host, relative to the home directory. */
export const HOST_KEY_FILE = ".config/sandcastle/opencode-go.key";
/**
 * The key path as the Seatbelt sandbox sees it: the host file identity-mounted
 * at its own path. The OpenCode config points here rather than at OpenCode's
 * own auth file, which would bring the host's other provider keys with it.
 */
export const SANDBOX_KEY_PATH = resolve(homedir(), HOST_KEY_FILE);
/** The environment variable OpenCode reads for Ollama Cloud. */
export const OLLAMA_KEY = "OLLAMA_API_KEY";

export function fallbackProvider(model: string): FallbackProvider | null {
  return FALLBACK_PROVIDERS.find((provider) => model.startsWith(`${provider}/`)) ?? null;
}

/**
 * The model that authors a ticket: the fallback once the ticket has stalled
 * under the primary, when a fallback is configured.
 */
export function authorModelFor(
  strikes: readonly Strike[],
  primary: string,
  fallback: string | null,
): string {
  if (fallback === null) return primary;
  return strikes.some((strike) => strike.kind === "stalled") ? fallback : primary;
}

/**
 * The model behind a route, whoever serves it: `deepseek-v4.1-flash` for
 * `opencode-go/deepseek-v4.1-flash`, `ollama-cloud/deepseek-v4.1-flash:1017`
 * and `opencode/deepseek-v4.1-flash-free` alike.
 */
export function modelFamily(model: string): string {
  return model
    .slice(model.indexOf("/") + 1)
    .replace(/:.*$/, "")
    .replace(/-free$/, "")
    .toLowerCase();
}

/**
 * The review routes for a ticket, in failover order. A review by the author's
 * own model is not independent, so a ticket a cloud model wrote loses every
 * route that serves that model. A ticket the local model wrote keeps them all:
 * its own route is the last resort that keeps the gate open when both cloud
 * providers are down.
 */
export function reviewRoutesFor(
  authorModel: string,
  routes: readonly string[],
): readonly string[] {
  if (fallbackProvider(authorModel) === null) return routes;
  // An explicit owner choice to use one model for both roles overrides the
  // independence filter (e.g. a free/unlimited flash model for a burst).
  if (routes[0] === authorModel) return routes;
  const family = modelFamily(authorModel);
  return routes.filter((route) => modelFamily(route) !== family);
}

/** The configured fallback models, in the order they are preferred. */
export function parseFallbackModels(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((model) => model.trim())
        .filter((model) => model !== ""),
    ),
  ];
}

/**
 * The first fallback model the factory can use now: its provider's credential
 * is on the host, and the pass has not found its route down. Null when none is.
 */
export function chooseFallback(
  models: readonly string[],
  credentialed: ReadonlySet<FallbackProvider>,
  unavailable: ReadonlySet<string>,
): string | null {
  return (
    models.find((model) => {
      const provider = fallbackProvider(model);
      return provider !== null && credentialed.has(provider) && !unavailable.has(model);
    }) ?? null
  );
}

/**
 * The sandbox OpenCode config with the fallback providers switched on.
 * OpenCode Go is told to read its key from the mounted file; Ollama Cloud
 * reads its key from the environment without being told. The configured cloud
 * models are registered under their provider: the sandbox image pins an older
 * OpenCode whose catalog can predate a model, and an unregistered model is
 * invisible to `opencode models` and unusable even with a valid credential.
 */
export function configWithProviders(
  config: string,
  providers: readonly FallbackProvider[],
  models: readonly string[] = [],
): string {
  const parsed = z
    .object({
      enabled_providers: z.array(z.string()),
      provider: z.record(z.string(), z.unknown()).default({}),
    })
    .passthrough()
    .parse(JSON.parse(config));
  const provider: Record<string, unknown> = { ...parsed.provider };
  for (const id of providers) {
    const registered = Object.fromEntries(
      models
        .filter((model) => model.startsWith(`${id}/`))
        .map((model) => [model.slice(id.length + 1), {}]),
    );
    if (id !== "opencode-go" && Object.keys(registered).length === 0) continue;
    const existing = (provider[id] ?? {}) as { models?: Record<string, unknown> };
    provider[id] = {
      ...existing,
      ...(Object.keys(registered).length > 0
        ? { models: { ...existing.models, ...registered } }
        : {}),
      ...(id === "opencode-go" ? { options: { apiKey: `{file:${SANDBOX_KEY_PATH}}` } } : {}),
    };
  }
  return JSON.stringify({
    ...parsed,
    enabled_providers: [...new Set([...parsed.enabled_providers, ...providers])],
    provider,
  });
}

/**
 * Whether the host key file can be mounted: it exists, holds something, and
 * no one but its owner can read it.
 */
export function hostKeyUsable(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && stats.size > 0 && (stats.mode & 0o077) === 0;
  } catch {
    return false;
  }
}
