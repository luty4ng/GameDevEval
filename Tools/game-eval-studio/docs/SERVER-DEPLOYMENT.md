# 账户版设计与容器部署指南

版本：1.2 · 2026-10-13。代码与本地 PostgreSQL/浏览器验证已完成；**部署进行中，服务器验收记录见 DEPLOYMENT-REPORT.md；公网 HTTPS 需确认域名后启用**。

## 技术选择

推荐 **React/Vite + Fastify + Better Auth + PostgreSQL 16**，Compose 运行 App 和 DB 两个容器，接现有 Traefik 的 HTTPS 入口。数据库放在同一服务器的独立容器，浏览器只访问 API。

2026-10-13 经 SSH 别名 `luty-server` 只读确认：Docker 27.5.1、Compose v2.32.4、Traefik v3.2；服务器总内存约 3.6 GB、可用约 2.4 GB，磁盘剩余约 23 GB。该容量支持小规模专家工作台是工程判断，尚未进行负载测试。Compose 为 App、数据库各设 512 MB 上限，应按实际使用监控调整。

服务器已有其他应用的 PostgreSQL 16，位于该应用的私有网络。默认不复用其业务库或账号；采用独立容器和卷，升级与恢复范围更清楚。后续如要集中数据库，可使用现有实例中新建的专用数据库与普通角色，并把 API 的 `DATABASE_URL` 改为可达地址；跨主机连接需要 TLS 和网络访问控制，不向浏览器提供数据库密码。

| 方案 | 本次判断与代价 |
| --- | --- |
| PostgreSQL | 推荐：账户关系、事务、并发保存与 JSONB 同时适用；需要维护备份和迁移。 |
| SQLite | 单机原型更轻，但集中数据库、后续多人查询和多实例服务需要额外演进。 |
| MySQL | 可以实现，但当前服务器已有 PostgreSQL 运维基础，换库收益有限。 |
| Supabase / Keycloak | 适合更完整的平台或统一身份体系；当前范围只需邀请、密码与个人设置，增加服务数量和资源成本。 |

选择依据：[Better Auth PostgreSQL 适配器](https://better-auth.com/docs/adapters/postgresql)、[邮箱密码认证](https://better-auth.com/docs/authentication/email-password)、[会话设计](https://better-auth.com/docs/concepts/session-management)、[Fastify 集成](https://better-auth.com/docs/integrations/fastify)、[Docker 网络](https://docs.docker.com/compose/how-tos/networking/)、[Traefik 3.2 Docker provider](https://doc.traefik.io/traefik/v3.2/providers/docker/)。采用认证库处理密码哈希、Cookie 和会话，不自行发明密码算法。

## 数据和权限

```mermaid
flowchart LR
  Browser[浏览器 / 专家] -->|HTTPS| Proxy[现有 Traefik]
  Proxy -->|traefik-net| App[React 静态页 + Fastify API]
  App -->|私有 backend 网络| DB[(PostgreSQL 16)]
  DB --- Volume[专用持久卷]
```

- 认证库维护 `user`、`account`、`session`、`verification`、`rateLimit` 表。
- `app_invite`：绑定邮箱、随机 256-bit 令牌的 SHA-256、创建人、7 天有效期、使用/撤销时间。链接令牌在 URL fragment 中，数据库只存摘要；原始链接只在创建时展示一次。
- `app_preferences`：按账户保存名称之外的默认引擎、版本、平台、难度、时间和通过阈值。只应用到新任务。
- `app_workspace`：每个用户一个工作区 JSONB，加 `user_id`、`revision` 和更新时间。复用 v1 严格交换格式，以最小迁移成本保存任务、规则、试评和冻结快照。上限仍是每人 100 题、每次请求 10 MB；每次保存整体工作区，未来大题库或多人共同编辑需拆成任务/评审表。
- API 从服务端会话取得身份，每次读取用户状态；客户端不能指定其他用户 ID 或提升角色。管理员管理用户与邀请，当前没有读取其他用户题库的接口。
- 保存用事务锁和 revision 比较，同版本并发只允许一次成功，另一次返回 409；前端暂停保存，保留内存改动，允许备份、加载最新数据或明确确认后重试。
- 已有任务的冻结快照在 API 中不能改写或移除。删除整个任务同时删除其题内版本，界面有确认；题库备份应在删除前下载。

注册流程：管理员创建邀请 → 自行通过可信渠道交付链接 → 专家填写同一邮箱、显示名称和至少 15 字符密码 → 注册 → 登录 → 加载自己的题库与偏好。邀请码不提供公开注册通道，角色不能从注册表单设置。

会话 Cookie 为 HttpOnly、SameSite=Lax，公网生产模式强制 HTTPS/Secure；API 写请求必须带匹配 `APP_URL` 的 Origin。响应不缓存私有数据。公网生产部署只信任一个代理跳数，认证限流 IP 由 API 覆盖为该解析结果，外部无法通过自带身份头提升权限。App 应只暴露给 Traefik 与 loopback，不能把 3000 发布到公网。

登录每 IP 每分钟最多 10 次，公开注册每 IP 每分钟最多 5 次；认证限流写数据库。通用 HTTP 限流在单 App 进程内，当前 Compose 仅运行单实例。未接 SMTP、邮箱验证、MFA、团队共享、附件上传、模型 API key 或运行器。邀请者负责核实邮箱；忘记密码由具备服务器运维权限的人员线下重置。

邀请行在注册期间锁定防止重复消费；认证库创建用户/密码记录使用自己的连接。若进程恰在账户创建后、邀请标记前崩溃，账户可能已创建而邀请未标记；重复注册会提示账户已存在，用户可登录，管理员可撤销该邀请。不会创建第二个账户或放开其他邮箱注册。

## 本地开发

无需账户的本地版继续使用 `npm run dev`。账户版需要 PostgreSQL 16，两个终端运行 API 和 Vite：

1. `npm ci --registry=https://registry.npmjs.org`。
2. 复制 `.env.example` 到 `.env.local`；填写开发数据库 URL、独立 AUTH_SECRET，设置 `APP_URL=http://127.0.0.1:5173`、`NODE_ENV=development`。不要提交此文件。
3. 使用 `node --import tsx --env-file=.env.local server/manage.ts migrate` 初始化表。
4. `python scripts/account-input.py admin | node --import tsx --env-file=.env.local server/manage.ts admin`，交互输入首个管理员；密码不作为命令参数。
5. 终端 A：`npm run dev:api`；终端 B：`npm run dev:client`。浏览器打开 `http://127.0.0.1:5173`；Vite 把 `/api` 转给 3000。

静态生产预览与 API 一体运行时用 `npm run build:server`，API 的 `APP_URL` 改为实际访问 origin。普通 `npm run build` 仍生成无需登录的本地版，不能用它作为账户版部署构建。

## luty-server 部署步骤

以下为目标服务器上的 Linux 命令说明，**未在服务器执行**。正式执行前确认域名、DNS、现有 Traefik 的 HTTPS entrypoint 和 certificate resolver 名称，以及 loopback 3000 是否空闲。`traefik-net` 网络已经存在；不重启或改写现有 Traefik。

1. 在专用目录检出仓库，进入 `Tools/game-eval-studio`，从 `.env.example` 创建 `.env`。设置 `APP_URL=https://实际域名`，`APP_HOST=实际域名`，填写已配置的 Traefik resolver。
2. 为 `DB_ADMIN_PASSWORD`、`DB_PASSWORD`、`AUTH_SECRET` 分别生成独立随机值。DB_PASSWORD 使用十六进制，避免拼接 URI 的特殊字符问题；`.env` 仅允许运维用户读取。生产 API 自 Compose 得到 `NODE_ENV=production`，不会使用示例中的 development。
3. 校验和构建（`--quiet` 避免展开打印配置里的秘密）：

```sh
docker compose -f compose.yaml -f compose.traefik.yaml config --quiet
docker compose -f compose.yaml -f compose.traefik.yaml build app
docker compose -f compose.yaml -f compose.traefik.yaml up -d db
docker compose -f compose.yaml -f compose.traefik.yaml run --rm -T app npm run db:migrate
python3 scripts/account-input.py admin | docker compose -f compose.yaml -f compose.traefik.yaml run --rm -T app npm run admin:init
docker compose -f compose.yaml -f compose.traefik.yaml up -d app
```

DB 首次初始化创建普通角色 `gameeval`，它拥有本应用库和表，不能创建其他库/角色，没有 superuser 权限。API 不使用 `postgres` 管理员连接。初始化脚本只在空卷首次启动执行；已有卷修改 `.env` 的 DB_PASSWORD 不会自动改变数据库密码。

4. 打开 HTTPS 地址验收邀请注册、登录、跨设备保存、配置、停用和退出；检查会话 Cookie 的 Secure/HttpOnly，访问 `/health` 应返回 `{"status":"ok"}`。数据库没有发布宿主机 5432，App 容器以非 root 用户运行、只读根文件系统，不挂 Docker socket。
5. 容器重启后再次确认题库与配置存在。**这些线上验收尚未完成，不能把本地测试等同于已上线。**

如果使用已有 PostgreSQL 实例：为其建立专用库、普通拥有者角色和网络访问，调整 `DATABASE_URL`，移除本 Compose 的 `db` 依赖后再校验。不能直接替换成其他应用的库和账号。

## 备份、恢复与密码重置

用户 JSON 备份仅包含本人的题库，不包含登录账户、偏好、邀请和数据库会话。完整服务恢复需要 DB 备份以及妥善保管的服务配置/密钥；数据库备份包含个人资料和认证摘要，应加密并存储到服务器之外。

Linux 上备份整个应用数据库，建议自动保留每日备份并定期做恢复演练：

```sh
docker compose exec -T db pg_dump -U postgres -d gameeval -Fc > gameeval-backup.dump
```

先恢复到新的隔离库，不覆盖运行中的库：

```sh
docker compose exec -T db createdb -U postgres -O gameeval gameeval_restore
docker compose exec -T db pg_restore -U postgres -d gameeval_restore --no-owner --role=gameeval < gameeval-backup.dump
```

验证新库中的题库数量和账户后，再规划停写、切库及回退。本文不授权覆盖旧库、删除卷或重启其他服务。备份命令依据 [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)。

忘记密码时，核验用户身份后，由运维在专用目录执行：

```sh
python3 scripts/account-input.py reset-password | docker compose run --rm -T app npm run password:reset
```

命令通过 stdin 接收邮箱和新密码，以认证库的哈希算法更新该账户，并撤销全部会话。首次管理员初始化只允许一次；不提供浏览器抢占首个管理员的入口。用户启用状态保持原值，停用账户需管理员另行启用。

## 已执行验证与待验收

实际验证：43 项自动测试、9 项账户浏览器流程、18 项原本地版浏览器流程通过；两个构建模式及类型检查通过，npm audit 为 0。Compose 文件通过 YAML 解析，初始化脚本通过 `bash -n`。

执行本地 `npm test` 可在 loopback 启动真实 PostgreSQL 16.14 临时实例（embedded-postgres），使用随机专用目录并在结束时清理，不连接个人服务器数据库。覆盖认证、邀请、权限、账户数据隔离、JSONB、revision 冲突、冻结保护、修改密码、撤销会话及停用/启用。

账户浏览器测试：先 `npm run build:server`，一个终端运行 `node --import tsx tests/browser-server.ts`，另一个终端 `python tests/accounts_e2e.py`。前者创建独立临时 PostgreSQL 和假账户，结束时 Ctrl+C 停止；勿用于生产。依赖见 `tests/requirements.txt`。

部署时还需完成 Docker build、Compose health、TLS/Cookie、备份恢复与服务器重启持久化验收。当前没有验证生产负载或长时间断电耐久性。

## 无域名时的 SSH 部署模式

可设置 `ACCESS_MODE=ssh`、`APP_URL=http://127.0.0.1:3000`，只使用 `compose.yaml`，不加载 Traefik 覆盖文件。容器仍使用生产运行环境、普通数据库角色和私有网络；宿主机只绑定 127.0.0.1:3000。应用仅允许 loopback origin，Cookie 保留 HttpOnly/SameSite，SSH 连接承担网络加密，不能把此模式用于公网 HTTP。

本机执行 `ssh -N -L 3000:127.0.0.1:3000 luty-server`，再打开 `http://127.0.0.1:3000`。客户端端口必须为 3000，与 APP_URL 一致。确定域名后，切换 `ACCESS_MODE=public`、HTTPS APP_URL/APP_HOST，并加载 Traefik 覆盖文件重建本应用容器；保持 DB_PASSWORD、AUTH_SECRET 和持久卷，重新登录新 origin。

依赖分层、调用链和技术替换步骤见 [架构文档](ARCHITECTURE.md)，稳定协议见 [OpenAPI](API.openapi.json)。生成协议命令为 `npm run schema:api`。
