# OpenCLI自研扩展维护约定

## 固定入口

- 固定仓库路径：`/Users/zhaoyuchen/Documents/svn/opencli`。
- 自研扩展开发、构建和维护均复用本仓库；不在会话目录或临时目录另建维护克隆。
- 不使用Git worktree。
- 日常整合分支为 `yinzon/extensions`，当前工作区可同时使用两个扩展。

## 分支和远端

- `origin`：`https://github.com/zhao-yc/OpenCLI.git`，自有fork，提交和推送到这里。
- `upstream`：`https://github.com/jackwener/OpenCLI.git`，用于读取上游更新。
- 京东独立PR分支：`codex/jd-union-promotion-link`，PR #2575。
- uniCloud独立PR分支：`feat/unicloud-free-renewal`，PR #2676。
- 两个PR分支保留独立历史；不要把整合分支的维护文档和另一扩展混入单项PR。
- 功能修改在对应任务分支验证、提交、推送后，再合入 `yinzon/extensions`。
- 开始前检查分支、工作区、上游并fetch；干净且可快进时同步当前分支。存在无关修改时保留现场，不自动stash或重写历史。
- 完成代码修改后只暂存本任务改动，使用中文提交信息，推送到明确的origin对应分支。不得强推或自动合并远端main。

## 验证

- 安装依赖使用 `npm ci`，构建使用 `npm run build`。
- 专项回归：`npx vitest run --project adapter clis/jd clis/unicloud`。
- 类型检查：`npm run typecheck`；定义检查：`node dist/src/main.js adapter check jd` 与 `node dist/src/main.js adapter check unicloud`。
- 构建会清理dist；构建与读取dist的测试顺序执行。
- 日常CLI使用 `node dist/src/main.js`，不擅自替换全局npm安装。
- uniCloud默认只预览；实际0元续费在用户授权的空间范围内执行，并核对到期时间延长。禁止结果不明时重复提交。
- 不自行创建定时续费任务。
- 外置浏览器默认ego lite。截图、账号订单记录放 `.local/` 或受保护归档，不进入Git。
- 不使用本机Docker；本任务不需要Docker。

## 交付与记录

- 中文维护入口为根目录 `维护说明.md`。
- 密钥、Cookie、令牌和登录资料不得提交。正式交付按用户既定规则备份到同步空间，另存版本并核对SHA-256。
