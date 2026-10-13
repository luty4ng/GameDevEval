# 服务器部署验收记录

状态：**2026-10-13 已部署到 luty-server，并通过真实容器和浏览器验收。当前使用 SSH 隧道访问；公网 HTTPS 尚未启用，待提供域名。**

## 当前运行环境

| 项目 | 实际结果 |
| --- | --- |
| 应用 | GameEval Studio 1.2.0，Node.js 24.21.0 / TypeScript / Fastify 5.12.7 / Better Auth 1.7.7 |
| 数据库 | 独立 PostgreSQL 16.15 容器；API 使用普通角色 `gameeval` |
| 容器平台 | Docker 27.5.1 / Compose v2.32.4，项目名 `gameeval` |
| 镜像源码 | `408b6e8b3717406d2110cc946f814e7e73b53a4d` |
| 镜像 | `gameeval-studio:1.2.0`，另有 `gameeval-studio:408b6e8` 标签 |
| 镜像 ID | `sha256:fa54b641f04b315c536459abd99a4a8b0b838a948932e13b0090bc51e5a8beed` |
| 发布目录 | `/home/ubuntu/gameeval/releases/408b6e8b3717406d2110cc946f814e7e73b53a4d` |
| 私有配置 | `/home/ubuntu/gameeval/shared/.env`；目录 700、配置文件 600 |
| 持久卷 | `gameeval_postgres-data` |
| 访问入口 | 宿主机 `127.0.0.1:3000`，`ACCESS_MODE=ssh`；通过 SSH 转发访问 |
| 公网入口 | 未启用 Traefik 路由；尚无指定域名及 TLS 验收 |

镜像由上述源码构建。验收中修复的 Compose 接入网络及运维脚本已同步发布目录，并随本次后续提交保存；镜像应用代码保持上述 revision，不能将文档提交号当作镜像源码版本。

## 实际验收

- 服务器执行 Docker 多阶段构建、`npm ci` 与账户版类型检查/生产构建成功；安装审计为 0 漏洞。
- `compose config --quiet` 通过，显式执行 `db:migrate` 与 stdin 管理员初始化；App、DB 均 healthy。
- 真实 API 验证未登录拒绝、邀请注册/重放拒绝、登录、普通用户无管理员权限、跨 Origin 拒绝、个人与评测默认配置；管理员题库仍为空，与验收用户隔离。真实 SSH 模式会话 Cookie 的 HttpOnly/SameSite=Lax 与 loopback HTTP 可用性通过检查。
- 本机 Chromium 通过 SSH 访问真实服务器：登录、应用 Godot/专家默认配置、新建和编辑需求任务、自动保存与刷新、冻结 v1、实际 ZIP 下载、全部 manifest SHA-256 校验、退出通过；375/768/1024/1440 宽度无文档横向溢出，未出现未处理 JavaScript 错误。
- 真实并发提交同一 revision，一次 200、一次 409。
- 仅重启本应用 App/DB 两个容器后，题库、冻结版本及默认配置与事前快照一致。
- `pg_dump -Fc` 备份恢复到全新隔离库 `gameeval_restore_deployment`；8 张 public 表逐表数量/内容摘要一致，普通数据库角色没有 superuser/createdb/createrole 权限。
- 初始管理员使用随机密码。验收使用合成数据与临时普通用户，结束后已停用该用户、撤销会话，并验证停用后不能登录；未向工具输出管理员密码、Cookie 或邀请令牌。
- 原有 5 个其他服务的容器 ID 和运行状态未变化，未重启 Traefik 或其他应用。

App 以 `node` 用户运行、只读根文件系统、`cap_drop=ALL`、`no-new-privileges`，仅发布 loopback 3000；DB 未发布端口且只连接内部网络。验收后单次空闲采样：App 约 75 MiB、DB 约 42 MiB，各有 512 MiB 上限。这不是负载测试或容量承诺。

## 验收发现与修复

初次容器内健康检查通过，但宿主机请求被拒绝：Docker 对仅连接 `internal` 网络的 App 没有启用端口发布。已给 App 增加独立 `entry` 网络，DB 保持 `backend.internal=true`；重新创建 App 后，实际 loopback 请求与 Chromium 流程通过。此问题说明容器健康不能代替真实入口验收。

首次长时间闲置的 SSH 验收连接被重置；重新建立带 keepalive 的隧道后完成浏览器流程，操作指南已加入对应参数。公网部署不依赖用户保持 SSH 连接，仍需指定域名后配置。

## 操作入口与维护

在自己的电脑执行并保持终端连接：

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 3000:127.0.0.1:3000 luty-server
```

打开 `http://127.0.0.1:3000/`。初始管理员登录标识为 `admin@gameeval.local`，密码输入文件位于服务器 `/home/ubuntu/gameeval/shared/initial-admin.json`，权限为 600。运维自行通过 SSH 查看，首次登录后在“账户与配置”修改密码；此标识不代表真实邮箱，也不发送邮件。该初始文件不会随网页改密自动更新；改密后它不再代表当前密码。

服务器只读检查命令：

```sh
cd /home/ubuntu/gameeval/releases/408b6e8b3717406d2110cc946f814e7e73b53a4d
docker compose --env-file /home/ubuntu/gameeval/shared/.env ps
curl -fsS http://127.0.0.1:3000/health
```

验收备份 `/home/ubuntu/gameeval/shared/backups/deployment-verified.dump` 为 600，目录为 700；包含验收时的账户数据，仅供运维保管，不放入仓库或公开下载。隔离恢复库与停用测试账号保留用于核验，没有覆盖运行库或删除真实用户数据。该一次性备份不替代日常备份；当前尚未配置自动备份或离机副本。

日常管理员操作、注册和题目生产见 [操作指南](USER-GUIDE.md)。部署切换、数据库备份/恢复和密码重置见 [部署指南](SERVER-DEPLOYMENT.md)；替换后端框架、数据库或认证实现见 [架构说明](ARCHITECTURE.md)。

## 验证边界

本地另有 47 项自动测试、9 项账户浏览器流程、18 项本地版生产预览流程通过。服务器验收使用合成任务，未运行游戏或评估真实 coding agent。尚未验证公网 TLS、真实专家使用、生产并发负载、整机重启或长时间断电耐久性。面向无 SSH 权限的专家开放前，需要提供域名、配置 DNS/Traefik HTTPS 并复测公网 Cookie 和流程。
