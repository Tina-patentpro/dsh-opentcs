import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { createClient } from "./client.js";

/**
 * @dadi/opentcs — DSH host plugin for openTCS-based fleet control.
 *
 * v0.1.0: five tools — kernel.info / vehicles / order.create / order.cancel / events.
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

/** Resolve the API key through the optional credentials seam. */
async function resolveApiKey(ctx, envName) {
  const credentials = ctx.get("credentials");
  if (!credentials || !envName) return undefined;
  const hit = await credentials.resolve(credentialRef(envName));
  return hit?.value;
}

/** Build a per-call client with the key resolved at call time. */
async function makeClient(ctx, config) {
  const apiKey = await resolveApiKey(ctx, config.apiKeyEnv);
  return createClient(config, { apiKey });
}

/** Loose JSON schema for passthrough kernel objects (openTCS models evolve). */
const PASSTHROUGH_OBJECT = { type: "object", additionalProperties: true };

const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export function apply(ctx, config) {
  ctx.systemPrompt.section({
    name: "opentcs",
    order: 200,
    text:
      "Use the opentcs.* tools to inspect and control the openTCS fleet kernel " +
      "(vehicles, transport orders, status events). For fleet commands like " +
      "moving material between stations, translate the request into an " +
      "`opentcs.order.create` call with concrete location names; confirm with " +
      "the operator before withdrawing orders or taking risky actions."
  });

  ctx.tools.register(
    defineTool({
      name: "opentcs.kernel.info",
      description: "获取 openTCS 调度内核信息（内核版本与定制标识），用于验证插件与调度内核的连通性。",
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
        return await (await makeClient(ctx, config)).getKernelInfo();
      }
    }),

    defineTool({
      name: "opentcs.vehicles",
      description:
        "列出调度内核中的车辆及其状态（状态、处理状态、电量、位置、集成级别、当前订单）。可传 procState 过滤（IDLE/AWAITING_ORDER/PROCESSING_ORDER）。",
      parameters: {
        procState: {
          type: "string",
          required: false,
          enum: ["IDLE", "AWAITING_ORDER", "PROCESSING_ORDER"],
          description: "按处理状态过滤车辆（可选）"
        }
      },
      output: {
        schema: { type: "array", items: PASSTHROUGH_OBJECT }
      },
      async execute(args) {
        const vehicles = await (await makeClient(ctx, config)).listVehicles();
        return args?.procState ? vehicles.filter((v) => v.procState === args.procState) : vehicles;
      }
    }),

    defineTool({
      name: "opentcs.order.create",
      description:
        "创建运输订单并交给内核分派：指定目的地（位置名 + 操作，如 Load/Unload）序列，可选类型/意向车辆/期限。订单名需唯一（建议 TOrder-<时间戳>）。",
      parameters: {
        name: {
          type: "string",
          required: true,
          description: "订单唯一名，建议 TOrder-<ISO时间戳>，如 TOrder-20260901T120000Z"
        },
        destinations: {
          type: "array",
          required: true,
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              locationName: { type: "string", description: "目标位置名（Plant Model 中的 Location 名）" },
              operation: { type: "string", description: "目标操作，如 Load / Unload / Park" }
            },
            required: ["locationName", "operation"]
          },
          description: "目的地序列（至少 1 个）"
        },
        type: {
          type: "string",
          required: false,
          description: "订单类型（可选，如 Transport/Park）"
        },
        intendedVehicle: {
          type: "string",
          required: false,
          description: "意向车辆名（可选，缺省由内核分派）"
        },
        deadline: {
          type: "string",
          required: false,
          description: "截止时间（ISO 8601 UTC，如 2018-05-17T06:42:40.396Z，可选）"
        },
        dispensable: {
          type: "boolean",
          required: false,
          description: "是否可被自动撤销（可选，默认 false）"
        }
      },
      output: { schema: PASSTHROUGH_OBJECT },
      async execute(args) {
        if (!TOOL_NAME_RE.test(args.name)) {
          throw new Error("订单名不合法：仅允许字母、数字、._-，长度 1–128");
        }
        const body = {
          destinations: args.destinations,
          ...(args.type ? { type: args.type } : {}),
          ...(args.intendedVehicle ? { intendedVehicle: args.intendedVehicle } : {}),
          ...(args.deadline ? { deadline: args.deadline } : {}),
          ...(args.dispensable !== undefined ? { dispensable: args.dispensable } : {})
        };
        return await (await makeClient(ctx, config)).createTransportOrder(args.name, body);
      }
    }),

    defineTool({
      name: "opentcs.order.cancel",
      description:
        "撤销（withdraw）指定运输订单。immediate=true 会尽快中止（慎用：车辆不在节点上时可能导致碰撞/死锁，并中止相关外围任务）。",
      parameters: {
        name: { type: "string", required: true, description: "要撤销的运输订单名" },
        immediate: {
          type: "boolean",
          required: false,
          description: "是否立即中止（默认 false：车辆先行驶到安全点）"
        }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            order: { type: "string" },
            withdrawn: { type: "boolean" },
            immediate: { type: "boolean" }
          }
        }
      },
      async execute(args) {
        await (await makeClient(ctx, config)).withdrawTransportOrder(args.name, args.immediate ?? false);
        return { order: args.name, withdrawn: true, immediate: args.immediate ?? false };
      }
    }),

    defineTool({
      name: "opentcs.events",
      description:
        "查询内核最近的运行事件（车辆/订单/外围任务状态消息），用于诊断异常（订单失败、车辆故障、路径问题等）。",
      parameters: {
        limit: {
          type: "integer",
          required: false,
          description: "最多返回最近多少条事件（默认 20）"
        }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            timeStamp: { type: "string" },
            statusMessages: { type: "array", items: PASSTHROUGH_OBJECT }
          }
        }
      },
      async execute(args) {
        const limit = args?.limit ?? 20;
        const events = await (await makeClient(ctx, config)).getEvents({ timeout: 1000 });
        return {
          timeStamp: events.timeStamp,
          statusMessages: events.statusMessages.slice(-limit)
        };
      }
    })
  );
}
