# 部署与运维

## 运行平台

主应用面向 Cloudflare Workers。生产需要 D1、两个业务 Queue 及对应死信 Queue、Durable Objects 和定时触发器。概念素材归档还需要 R2。资源和服务使用费用由部署者承担；源码不会自动开通付费服务。

本地构建预览使用：

```sh
pnpm build
pnpm start
```

`start` 启动本地 Worker 模拟器。它不是把 Node 进程上线的命令。仅静态部署 `dist/client` 会缺失鉴权、数据库和任务执行。

## 1. 创建自己的资源

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create metis-voc-db
pnpm exec wrangler queues create metis-voc-research-dlq
pnpm exec wrangler queues create metis-voc-research
pnpm exec wrangler queues create metis-voc-concept-archive-dlq
pnpm exec wrangler queues create metis-voc-concept-archive
```

把新 D1 UUID 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`。源码中的全零 UUID 只供本地使用，部署检查会阻止误上线。按需修改 Worker、数据库和 Queue 名称，生产/测试使用独立资源。不要覆盖其他应用的绑定。

自己的资源 ID 仅用于本地部署配置，不应提交到公共仓库。常规源码检查会将它列为需复核项；发布 CI 的严格扫描会拒绝它。发布通用源码时恢复全零占位符，部署时使用自己的 ID。真正的密钥必须通过 secrets 配置，不能写入 vars。

Durable Object 类和迁移已在配置中声明。首次运行通过 `ensureSchema` 建表与兼容升级；`drizzle/` 为历史结构迁移，不应在已有数据库上盲目重复执行。升级前导出数据库并在测试环境演练。

## 2. 设置生产秘密

在全新安装可通过 `pnpm setup:local --email admin@example.com` 生成格式正确的随机管理员与哈希，使用独立安全环境生成生产值。不要将本地测试密钥直接复用于生产。

用交互式命令逐一设置，避免将值写进 shell 历史：

```sh
pnpm exec wrangler secret put SETTINGS_ENCRYPTION_KEY
pnpm exec wrangler secret put BOOTSTRAP_ADMIN_EMAIL
pnpm exec wrangler secret put BOOTSTRAP_ADMIN_PASSWORD_HASH
pnpm exec wrangler secret put BOOTSTRAP_ADMIN_NAME
```

加密密钥为 32 随机字节的 base64url；密码哈希格式与 `lib/auth.ts` 一致（PBKDF2-SHA256、100000 轮、16 字节盐、32 字节摘要）。已有用户的安装不会通过 bootstrap 重置密码或提权。

按需以相同方式设置 `DEEPSEEK_API_KEY`、`QWEN_API_KEY`、`KEEPAMORE_API_KEY`、`LOVART_ACCESS_KEY`、`LOVART_SECRET_KEY`。租户自有凭据可以在设置页配置。`.env.example` 列出所有可用配置。

保管并备份 `SETTINGS_ENCRYPTION_KEY`；直接替换会导致已有加密租户配置不可读。当前没有自动密钥轮换迁移工具，应先解密迁移并在测试环境验证。

## 3. 概念图与 R2（可选）

创建自己的 R2 bucket，在 `wrangler.jsonc` 加入：

```json
{
  "r2_buckets": [
    { "binding": "PRODUCT_IMAGES", "bucket_name": "your-private-image-bucket" }
  ]
}
```

不要为 bucket 开放公开列表。应用使用不可猜测的素材令牌提供资源，该链接属于持有者可访问的能力链接，应按报告敏感程度管理。下载源需要标准 HTTPS 域名；不接受 IP 字面量、内网名称、用户凭据或非标准端口。不要把可配置上游开放给不受信任的人。

R2/归档队列未就绪时，真实概念图工作流应保持不可用；源码里的 SVG 示意图不代表服务已配置。

## 4. 验证并部署

```sh
pnpm check
pnpm test:smoke
pnpm deploy
```

`deploy` 在构建前检查资源占位符、Queue 绑定、明文密钥和跨域白名单。它不能替代云账号权限和资源存在性验证。Wrangler 会使用构建生成的 Worker 配置上传。

生产默认 `ENABLE_EXAMPLE_REPORTS=false`、`PAID_PROVIDER_CALLS_ENABLED=false`。完成供应商连通性、预算、积分规则和权限测试后，运营者才开启付费调用。

部署后检查 `/api/health`，再用实际账户检查登录、创建任务、队列执行、权限、积分与导出。不要用健康接口成功来证明所有外部服务可用。

## 5. 运营检查

| 关注项 | 建议观察 |
| --- | --- |
| HTTP | 错误率、P95/P99、429、鉴权失败、请求 ID |
| Queue | 积压、重试、死信、租约超时、恢复后的最终状态 |
| D1 | 查询延迟、写入量、索引、配额、备份与恢复演练 |
| 外部服务 | 额度、费用、超时、限流、失败率、数据新鲜度 |
| 积分 | 扣款与任务数量、重复退款、失败未结算记录 |
| 数据 | 有效样本、来源缺失、时间跨度、重复率、证据缺口 |
| 资产 | 归档失败、素材链接、权限及保留策略 |

仓库的本地压力基线用于暴露回归，不等于生产容量认证。大批量公开注册、高峰长报告、跨区域延迟和上游并发额度需要针对部署环境另测。默认 Queue 并发为 2，不能仅提高并发数解决上游配额和 D1 写入限制。

更新前保留上一 Worker 版本并备份 D1；先迁移兼容结构再验证应用。回滚 Worker 不自动回滚数据库与积分流水。不要通过删除/回滚业务流水“修正”扣费，应走可审计补偿。
