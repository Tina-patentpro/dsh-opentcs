/**
 * @dadi/opentcs — thin REST client over the openTCS kernel Web API v1.
 *
 * Pure functions, no Cordis/ctx dependency: `apiKey` and `fetchImpl` are
 * injected, which keeps the client unit-testable with a mock fetch and lets
 * the tools resolve the key through DSH credentials at call time.
 */

/**
 * @typedef {object} ClientConfig
 * @property {string} kernelUrl  Base URL of the kernel Web API v1 (e.g. http://host:55200/v1)
 * @property {string} apiKeyEnv  Env-var reference shown in error messages (never a value)
 * @property {number} timeoutMs  Per-request timeout
 */

/** Best-effort parse of the kernel's error body (usually an array of strings). */
async function readErrorDetail(res) {
  try {
    const text = await res.text();
    if (!text) return undefined;
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.join("；");
    if (typeof parsed === "string") return parsed;
    if (typeof parsed?.message === "string") return parsed.message;
    return text.slice(0, 200);
  } catch {
    return undefined;
  }
}

/**
 * Create a kernel API client.
 * @param {ClientConfig} config
 * @param {{ apiKey?: string, fetchImpl?: typeof fetch }} options
 */
export function createClient(config, options = {}) {
  const base = config.kernelUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const authHeaders = options.apiKey ? { "X-Api-Access-Key": options.apiKey } : {};

  async function request(path, { method = "GET", body, query } = {}) {
    const url = new URL(base + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          ...authHeaders,
          ...(body !== undefined ? { "content-type": "application/json" } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
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
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw new Error(
        `openTCS 请求失败（HTTP ${res.status}）${detail ? `：${detail}` : `：${path}`}`
      );
    }
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  return {
    /** GET /kernel/version */
    getKernelInfo: () => request("/kernel/version"),
    /** GET /vehicles */
    listVehicles: () => request("/vehicles"),
    /** GET /transportOrders */
    listTransportOrders: () => request("/transportOrders"),
    /**
     * POST /transportOrders/{name}
     * @param {string} name  unique order name (path parameter)
     * @param {object} body  TransportOrder creation body: { destinations: [{locationName, operation}], type?, intendedVehicle?, deadline?, dispensable? }
     */
    createTransportOrder: (name, body) =>
      request(`/transportOrders/${encodeURIComponent(name)}`, { method: "POST", body }),
    /**
     * POST /transportOrders/{name}/withdrawal
     * @param {boolean} immediate  abort as quickly as possible (use with care)
     */
    withdrawTransportOrder: (name, immediate = false) =>
      request(`/transportOrders/${encodeURIComponent(name)}/withdrawal`, {
        method: "POST",
        query: { immediate }
      }),
    /** GET /events (long-polling; timeout ≤ 10000 ms) */
    getEvents: ({ minSequenceNo, maxSequenceNo, timeout = 1000 } = {}) =>
      request("/events", { query: { minSequenceNo, maxSequenceNo, timeout } })
  };
}
