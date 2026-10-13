# 服务器部署验收记录

状态：部署进行中，最终执行结果将在服务器验收后更新。

目标为 luty-server 上的独立 Compose 项目 `gameeval`，专用 App/DB 容器、普通数据库角色和持久卷。部署目录采用 `/home/ubuntu/gameeval/releases/<commit>`，凭据保存在 `/home/ubuntu/gameeval/shared`，不进入仓库、构建镜像或报告。

未指定域名时使用 SSH 隧道访问，公网 HTTPS 在确认域名后启用。验收范围包括镜像构建、健康检查、账户/权限/Origin、浏览器编辑冻结导出、容器重启持久化与隔离库备份恢复；不能以健康检查代替这些流程验证。
