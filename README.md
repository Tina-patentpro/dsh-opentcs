# @dadi/opentcs

DSH 插件：为基于 openTCS 的车辆/AGV 车队提供自然语言控制与监控（宿主侧）。

AI 代理通过 DSH 对话直接操作 openTCS 调度内核（REST Web API v1）：
查车、下单、查事件、诊断异常；后续阶段增加 Web 监控面板（P3）。

> 架构前提见 `../docs/plans/2026-09-01-opentcs-dsh-concept.md`，
> 插件方案见 `../docs/plans/2026-09-01-dsh-opentcs-plugin-skeleton.md`。

## 安装（发布通道：GitHub 私有仓库）

```bash
# git 依赖方式（需安装机可访问私有仓库）
dsh plugin --profile web add "git+https://github.com/Tina-patentpro/dsh-opentcs.git#v0.0.1"

# 或 GitHub Packages npm 方式（需配置 PAT）
dsh plugin --profile web add "@dadi/opentcs@0.0.1"
```

## 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `kernelUrl` | `http://localhost:55200/v1` | openTCS 内核 Web API v1 基地址（正式环境改为工控机地址） |
| `apiKeyEnv` | `OPENTCS_API_KEY` | 内核 API Key 的环境变量**引用**，运行时经 DSH 凭据体系解析 |
| `timeoutMs` | `10000` | 请求超时（毫秒） |

**API Key 配置（推荐，明文不进配置）**：在 DSH 侧设置环境变量，并登记进 DSH 凭据管理：

```bash
# 设置环境变量（示例；凭据写入请走 DSH 凭据管理界面/命令）
setx OPENTCS_API_KEY "你的内核 accessKey"
```

内核侧：在 `opentcs-kernel/config/opentcs-kernel.properties` 中设置
`servicewebapi.accessKey = <key>`，然后重启内核。

## 工具清单（v0.1.0）

| 工具 | 说明 |
|---|---|
| `opentcs.kernel.info` | 内核版本/定制信息，验证连通性 |
| `opentcs.vehicles` | 车辆列表与状态（可按 procState 过滤） |
| `opentcs.order.create` | 创建运输订单（目的地序列 + 可选类型/意向车/期限） |
| `opentcs.order.cancel` | 撤销运输订单（可选 immediate 立即中止，慎用） |
| `opentcs.events` | 最近内核运行事件（异常诊断） |

规划（后续）：`opentcs.plant.summary`（布局概览）、`opentcs.order.list`、SSE 实时面板（P3）。

## 安全

- 安装前按 DSH 安全规范对插件包执行 gate_scan 自检。
- 插件只通过内核 Web API 通信，不接触车辆协议层；运动控制与安全联锁仍由
  openTCS 内核与安全 PLC 负责。
- API Key 只经凭据引用解析，不落盘、不进配置。

## 开发

```bash
pnpm install        # 安装依赖（@deepseek-ai/dsh-tools 等）
pnpm run smoke      # 模块加载冒烟测试
pnpm run test       # 单元测试（mock fetch）
OPENTCS_LIVE_TESTS=1 pnpm run test:live   # 集成测试（需内核在 localhost:55200）
```

版本发布：改码 → 升版本 → 打 tag → 推送私有仓库 → 安装机 `dsh plugin add`。
