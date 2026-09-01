import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

/**
 * @dadi/opentcs — DSH host plugin for openTCS-based fleet control.
 *
 * Skeleton (v0.0.1): registers `opentcs.kernel.info` against the live kernel
 * to prove the tool chain end-to-end. M2 extends the tool set
 * (vehicles / order.create / order.cancel / events) on the same seams.
 */

/** Plugin row id (matches `id` in cordis.patch.yml). */
export const name = "opentcs";

/** Cordis services this plugin consumes (resolved by the Loader). */
export const inject = ["tools", "systemPrompt"];

/** Schemastery schema for the plugin configuration. */
export const Config = z.object({
  /** Base URL of the openTCS kernel Web API v1, e.g. http://host:55200/v1 */
  kernelUrl: z.string().default("http://localhost:55200/v1"),
  /**
   * Environment-variable reference for the kernel API key, resolved through
   * the DSH credentials seam at call time. Never holds the key itself.
   */
  apiKeyEnv: z.string().default("OPENTCS_API_KEY"),
  /** Per-request timeout in milliseconds. */
  timeoutMs: z.number().min(100).default(10000)
});

/** Strip trailing slashes so paths compose cleanly. */
function kernelBase(config) {
  return config.kernelUrl.replace(/\/+$/, "");
}

/** Resolve the API key through the optional credentials seam. */
async function resolveApiKey(ctx, envName) {
  const credentials = ctx.get("credentials");
  if (!credentials || !envName) return undefined;
  const hit = await credentials.resolve(credentialRef(envName));
  return hit?.value;
}

/**
 * Minimal fetch wrapper over the kernel Web API v1 with normalized,
 * human-readable errors (Chinese) for the model.
 */
async function request(ctx, config, path, options = {}) {
  const apiKey = await resolveApiKey(ctx, config.apiKeyEnv);
  const headers = { ...(options.headers ?? {}) };
  if (apiKey) headers["X-Api-Access-Key"] = apiKey;
  let res;
  try {
    res = await fetch(`${kernelBase(config)}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch (err) {
    throw new Error(
      `openTCS 内核不可达（${config.kernelUrl}）。请检查内核是否运行、网络是否可达。(${err.message})`
    );
  }
  if (res.status === 403) {
    throw new Error(
      `openTCS API Key 无效或缺失：请配置环境变量 ${config.apiKeyEnv}（通过 DSH 凭据管理，勿写入配置文件）。`
    );
  }
  if (res.status === 404) {
    throw new Error(`openTCS 内核资源不存在：${path}`);
  }
  if (!res.ok) {
    throw new Error(`openTCS 内核请求失败（HTTP ${res.status}）：${path}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

export function apply(ctx, config) {
  ctx.tools.register(
    defineTool({
      name: "opentcs.kernel.info",
      description:
        "获取 openTCS 调度内核信息（内核版本与定制标识），用于验证插件与调度内核的连通性。",
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            baselineVersion: { type: "string" },
            customizationName: { type: "string" },
            customizationVersion: { type: "string" }
          }
        }
      },
      async execute() {
        return await request(ctx, config, "/kernel/version");
      }
    })
  );
}
