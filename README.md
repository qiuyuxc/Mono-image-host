# Mono image host

一个部署在 Cloudflare Workers 上的私人图床。前端使用 React、Vite 和 Tailwind CSS，图片存储在 Telegram，元数据与登录限速记录存储在 Cloudflare D1。

## 功能

- 管理密码登录，HMAC 签名 HttpOnly Cookie
- CSRF 与同源写操作保护
- 多图拖拽上传，支持 JPG、PNG、GIF、WebP
- 响应式瀑布流、公开图片直链和链接复制
- 同步删除 Telegram 消息与 D1 记录
- Telegram Bot webhook 入库
- Node SQLite 本地测试后端

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm ci
npm run dev:api
npm run dev
```

本地地址为 `http://127.0.0.1:5173`，默认测试密码为 `mono-local`。本地图片和 SQLite 数据写入 `local-data/`，不会提交到仓库。

运行检查：

```bash
npm run check
npm run build
```

## Cloudflare 部署

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 一键部署

```bash
npm run deploy
```

部署脚本会按 `database_name` 自动查找 D1；不存在时创建数据库，然后自动注入临时 UUID、执行 `migrations/` 中的迁移并部署 Worker。无需手动创建数据表，也无需修改或提交 `database_id`。

如果只需要在远程数据库执行迁移：

```bash
npm run db:migrate:remote
```

### 3. 设置 Secrets

首次部署完成后设置：

```bash
npx wrangler secret put TG_BOT_TOKEN
npx wrangler secret put STORAGE_CHAT_ID
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` 应使用高强度随机值，例如：

```bash
openssl rand -hex 32
```

可选设置：

```bash
npx wrangler secret put ALLOWED_USERS
```

`STORAGE_CHAT_ID` 建议使用一个群聊：把 Bot 设为群管理员并开启“删除消息”权限后，可删除任意时间的消息。
否则 Telegram 只允许删除 48 小时内的消息，老图片将无法从 Telegram 侧真正删除。

`ALLOWED_USERS` 是允许使用 Bot webhook 的 Telegram 用户 ID 或聊天 ID，多个值用逗号分隔。

Worker 会根据当前请求域名生成图片直链。若需要固定到自定义域名，可在 Cloudflare 中绑定域名，并在 `wrangler.toml` 的 `[vars]` 中配置 `DOMAIN`。

### 4. Telegram webhook

仅在需要通过 Bot 消息上传时设置：

```bash
curl "https://api.telegram.org/bot<token>/setWebhook?url=https://<domain>/webhook"
```

部署后应验证登录、上传、图片直链、列表和永久删除。Web 端单张图片默认限制为 20 MB。

## 环境变量

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `TG_BOT_TOKEN` | Secret | Telegram Bot Token |
| `STORAGE_CHAT_ID` | Secret | 存储图片的 Telegram chat ID |
| `ADMIN_PASSWORD` | Secret | Web 管理密码 |
| `SESSION_SECRET` | Secret | 会话 HMAC 密钥 |
| `ALLOWED_USERS` | Secret，可选 | Bot webhook 白名单 |
| `WEB_UPLOAD_MAX_MB` | Variable | Web 上传大小限制 |
| `SESSION_TTL_HOURS` | Variable | 登录会话时长 |
| `DOMAIN` | Variable，可选 | 固定图片直链域名 |

## License

[MIT](LICENSE)
