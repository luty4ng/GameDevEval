# 分层设计与替换技术栈

## 依赖方向

```text
React 页面 → HTTP client → 稳定 /api 协议
                            ↓
                 transport/fastify.ts
                            ↓
                 application/services.ts → shared 领域规则与协议
                            ↓
                 application/ports.ts（接口）
                            ↑
        infrastructure/postgres + better-auth + tokens
```

`server/app.ts` 是组装入口，负责选择实现与注入依赖，不包含业务决策。HTTP 层处理路由、Cookie 转发、Origin、限流和错误到 HTTP 状态的转换；应用服务处理权限、邀请政策、冲突和冻结保护；SQL、锁、事务、数据库行到 DTO 的转换全部留在 PostgreSQL 适配器。

`shared/model.ts`、`shared/domain.ts`、`shared/preferences.ts` 由浏览器和服务端共同使用，不导入 React、Fastify、pg 或认证库。`src/model.ts` 等仅作为兼容入口重新导出，旧前端调用不受移动影响。`shared/contracts.ts` 定义用户、配置、工作区和邀请的稳定交换结构及输入验证。

## 关键调用链

- 保存：`CloudApp → /api/workspace → createServices.saveWorkspace → WorkspaceRepository.update → PostgreSQL 事务/行锁 → revision+1`。结构校验、冲突规则和历史保护由服务执行；仓库只负责原子更新。
- 注册：`Login → /api/register → createServices.register → InvitationRepository.consume → IdentityProvider.register`。仓库保证串行消费；应用验证邮箱、有效期和一次性政策；认证适配器建立密码账户。
- 管理用户：`AccountPanel → /api/admin/users/:id → createServices.setUserStatus → AccountRepository.setDisabled`。管理员权限在业务服务内校验，换 HTTP 框架不会丢失权限检查；停用与删除会话在同一数据库事务内完成。
- 管理命令：`server/manage.ts → infrastructure/postgres/maintenance.ts`。stdin 验证和命令选择不含 SQL；认证表名、密码格式和运维锁仅在适配器内出现。

## 如何替换

| 要替换的部分 | 实施位置 | 必须保留的约束 |
| --- | --- | --- |
| Fastify → Express/Hono 等 | 新建 HTTP transport，在 `server/app.ts` 注入相同应用服务 | /api 方法、JSON、状态码、Cookie、Origin 校验、私有响应不缓存、真实 IP 限流 |
| PostgreSQL → 其他存储 | 实现 `WorkspaceRepository`、`AccountRepository`、`InvitationRepository`，替换 composition root 的工厂 | `update` 原子读改写，失败不提交；邀请串行消费；停用与撤销会话一致；按用户过滤 |
| Better Auth → 其他认证 | 实现 `IdentityProvider`，适配身份/会话和四个 auth endpoint；调整账户仓库和运维适配器 | 输入不能自设角色；禁用和过期会话不可访问；安全 Cookie 和会话撤销 |
| React → 其他前端 | 重用 `shared` 与稳定 API，重新实现视图 | 保存失败/冲突保留改动、备份恢复、专家工作流及公开/私有导出隔离 |
| 改后端语言 | 以 `docs/API.openapi.json` 为线协议，移植应用策略与评测校验 | 不能直接复用 TS 服务；需用现有集成/浏览器测试校验语义和安全行为 |

当前数据库外键仍关联 Better Auth 的 `user` 表；替换认证系统需要迁移用户 ID、密码和会话，而不是只替换函数。数据库 JSONB 全工作区存储仍是当前容量方案，未来拆表应在仓库与迁移中进行，业务服务保持相同 ports。邀请消费与认证库建号仍跨连接，崩溃窗口及恢复方式见部署指南。

## 验证分层

`tests/application.test.ts` 使用另一组内存仓库和假身份适配器运行真实业务流程，不启动 Fastify/PostgreSQL/Better Auth，证明服务无需依赖具体实现。原 PostgreSQL 集成测试继续验证事务、冻结、Cookie、角色与会话；真实浏览器测试验证稳定 API 与工作流兼容。内存替换测试不能证明生产事务能力，最终仍由 PostgreSQL 测试和线上部署验收提供证据。
