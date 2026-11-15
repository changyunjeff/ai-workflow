# n8n（截至 2026-11-14 的现状）

阅读说明（不是独立章节，只是读法）：

- 标记含义：【一手】= 本次直接读到 n8n 官方文档、官方博客、官方定价页或官方源码；【二手】= 来自论坛帖、第三方博客或搜索摘要，没读到官方原文；【未核实】= 本次没找到可靠来源，不作结论。
- 所有网页都是通过抓取工具读的，工具会先把网页转成文字再摘录，所以"引文"是摘录后的原话，个别措辞可能与网页有出入；长页面（MCP 工具清单、发布日志）只读了一部分，已在"缺口"里写明。
- 版本背景：n8n 2.0 之后是 2.x 线，本次看到的最新 2.x 是 2.47.3（2026-11-09）；n8n 3.0.0 于 2026-10-27 以 beta（测试版）发布，官方说稳定版在 12 月初，发布日志里已出现 3.1（11-03）、3.2（11-10）。也就是说 2026 年 11 月正处在 2.x 到 3.x 的换代期，下面每条都尽量写明是哪个版本的事。来源：[发布日志](https://docs.n8n.io/release-notes.md)、[3.0 官方博客](https://blog.n8n.io/introducing-n8n-v3)。
- 术语：节点（node）= 流程图上的一个方块，一步操作；工作流（workflow）= 一张由节点连成的流程图；执行（execution）= 工作流跑一次；自托管（self-hosted）= 装在自己电脑或服务器上；n8n Cloud = n8n 公司替你托管的付费版；MCP = 一种让 AI 代理调用外部工具的通用接口协议；Docker = 把程序装在一个隔离"集装箱"（容器）里运行的工具，容器里是一个小型 Linux，看不到宿主电脑上的程序和文件，除非专门挂载。

## 说法 1："n8n 的节点擅长调云端 API，碰本机程序和文件别扭"

### Takeaway
基本属实，而且从 2.0 到 3.0 越来越别扭：能跑本机命令、能读写本机文件的节点都还在，但 2.0 起默认关闭或默认只能碰一个指定目录，n8n Cloud 上干脆没有 Execute Command；3.0 起自托管只支持 Docker，命令是在容器里跑的，碰不到 Windows 本机装的 `claude` 之类的程序，除非自己做镜像或绕道 SSH。好消息是 Execute Command 节点本身没有超时，等一个命令跑十几分钟在节点层面没有障碍。

### Cited Findings
- 【一手】Execute Command 节点只在自托管可用，"It isn't available on n8n Cloud"；从 n8n 2.0 起默认禁用；在宿主机默认 shell 里跑（Windows 上是 `cmd`，macOS 上是 `zsh`）；"If you run n8n with Docker, your command will run in the n8n container and not the Docker host"（用 Docker 跑 n8n 时，命令在容器里执行，不在宿主机上）。— [Execute Command 节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executecommand.md)
- 【一手】2.0 破坏性变更："n8n will disable the `ExecuteCommand` and `LocalFileTrigger` nodes by default"，要重新启用需改环境变量 `NODES_EXCLUDE`（官方示例 `NODES_EXCLUDE="[]"`）。— [2.0 破坏性变更](https://docs.n8n.io/changelog/v20-breaking-changes.md)
- 【二手】有用户按文档设了变量仍然启用不了 Execute Command（帖子覆盖到 2.8.3 左右），也有人用 `N8N_NODES_INCLUDE` 无效。说明"默认关闭后重新打开"这一步本身有坑。— [论坛帖 238232](https://community.n8n.io/t/unable-to-re-enable-execute-command-node-in-n8n-2-0-using-documented-environment-variables/238232)、[论坛帖 268110](https://community.n8n.io/t/cant-enable-execute-command-node/268110)
- 【一手】Read/Write Files from Disk 节点：自托管默认可访问 n8n 进程能到的任何路径，但从 2.0 起 `N8N_RESTRICT_FILE_ACCESS_TO` 默认值是 `~/.n8n-files`，要读写别的目录必须显式配置（多个目录用分号隔开）；Docker 下路径指的是容器内的文件系统，要用宿主机目录得挂载卷；n8n Cloud 上只能访问 `/home/node/` 下的路径，且文件不保证持久。支持 `*`、`**`、`?`、`[]` 通配符批量读。— [Read/Write Files 节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.readwritefile.md)
- 【一手】源码（master 分支，本次读取时）：Execute Command 用 `spawn(command, { cwd: process.cwd(), shell: true, ... })` 启动命令；代码里没有任何超时设置；输出只保留最后 10 MiB（`MAX_OUTPUT_SIZE = 10 * 1024 * 1024`），更早的输出被丢弃；取消时先 SIGTERM，5 秒后 SIGKILL；返回 `exitCode`、`stdout`、`stderr`；退出码非 0 即视为出错。节点参数只有两个：`command` 和 `executeOnce`（没有"工作目录""超时""环境变量"参数）。— [ExecuteCommand.node.ts 源码](https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/ExecuteCommand/ExecuteCommand.node.ts)
- 【一手】工作流级超时：`EXECUTIONS_TIMEOUT` 默认 `-1`（不限时）；`EXECUTIONS_TIMEOUT_MAX` 默认 `3600` 秒，是用户能给单个工作流设的超时上限。— [执行相关环境变量](https://docs.n8n.io/hosting/configuration/environment-variables/executions.md)
- 【一手】Execute Command 常见问题：Docker 里"命令找不到"的官方解法是基于官方镜像自己做一个带该命令的镜像；Windows 上 PowerShell 多行命令"只执行第一行"，要写成一行或存成脚本用 `powershell -File` 跑；文档还列了"stdout maxBuffer length exceeded"（输出过大）错误。— [Execute Command 常见问题](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executecommand/common-issues.md)
- 【一手】3.0 起自托管必须用 Docker："Installs using npm or npx n8n are no longer supported"，3.0 不再向 npm 发布可运行的 `n8n` 包；官方给的理由是新的安全功能依赖容器环境。npm 安装页也写着"npm-based installs are deprecated from n8n 3.0"。— [3.0 破坏性变更](https://docs.n8n.io/changelog/v30-breaking-changes.md)、[3.0 官方博客](https://blog.n8n.io/introducing-n8n-v3)、[npm 安装文档](https://docs.n8n.io/hosting/installation/npm.md)
- 【一手】2.x 的 npm 安装要求 Node.js 20.19 到 24.x；Windows 只有一句"遇到问题请检查 Node.js 环境"。3.x 稳定版发布后 2.x 还有 12 个月的安全和严重缺陷修复。— [npm 安装文档](https://docs.n8n.io/hosting/installation/npm.md)、[3.0 官方博客](https://blog.n8n.io/introducing-n8n-v3)
- 【一手】SSH 节点有三个操作：执行命令、下载文件、上传文件；执行命令有"Working Directory"（工作目录）参数。— [SSH 节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.ssh.md)
- 【一手】Code 节点（在流程里写一段 JavaScript/Python 的节点）从 2.0 起默认跑在 task runner（隔离的代码执行进程）里，默认禁止读环境变量（`N8N_BLOCK_ENV_ACCESS_IN_NODE` 默认 `true`）；3.0 把 `N8N_RUNNERS_TASK_TIMEOUT` 从 300 秒降到 60 秒。— [2.0 破坏性变更](https://docs.n8n.io/changelog/v20-breaking-changes.md)、[3.0 破坏性变更](https://docs.n8n.io/changelog/v30-breaking-changes.md)
- 【二手】工作流超时是"软超时"，只在当前节点跑完后生效，掐不断一个正在卡住的节点；论坛有"执行卡了 100 多小时、超时设置不生效"的报告。— [超时配置示例](https://docs.n8n.io/hosting/configuration/configuration-examples/execution-timeout)（官方页，经搜索摘要读到）、[论坛帖 293999](https://community.n8n.io/t/n8n-workflows-not-respecting-timeout-settings-executions-stuck-for-100-hours/293999)

### Inferences
- "n8n 节点能不能启动本机的 `claude -p` 并等很多分钟"：在 2.x + npm 直接装在 Windows 上时可以——重新启用 Execute Command 后，它就是在 `cmd` 里跑一条命令，节点和工作流默认都不限时。但这条路在 3.x 上没了。
- 在 3.x（只能 Docker）+ Windows 上，Execute Command 跑在 Linux 容器里，看不到 Windows 上装的 Claude Code、Codex CLI、本机程序和本机盘符。可行的绕法只有三种：(a) 自己做镜像把 CLI 装进容器，并把工作目录挂进去；(b) 用 SSH 节点连回宿主机执行；(c) 在宿主机上另起一个小服务，n8n 用 HTTP 调它。三种都是额外搭建和维护，印证"别扭"。
- 文档里的"maxBuffer exceeded"错误与源码里"只留最后 10 MiB"的做法对不上，推测是文档对应旧实现（旧版用 `exec`，有缓冲上限），新实现改成了 `spawn`。具体从哪个版本改的未查。
- Code 节点不是启动本机程序的路：它在隔离进程里跑，3.0 起单次任务默认 60 秒超时，长任务不合适。
- 每放开一项本机能力（`NODES_EXCLUDE`、`N8N_RESTRICT_FILE_ACCESS_TO`、挂载卷）都是在和 n8n 的安全默认值对着干；n8n 的产品方向是"多人共用的服务器、不信任用户"，而本需求是"单人、本机、完全信任自己"，方向相反。

### Gaps
- 没有单独读 Local File Trigger（监视本机文件夹变化的触发节点）的文档页，只从 2.0 变更说明确认了"默认禁用"。
- 没查到 Code 节点沙箱是否明确禁止 `child_process`（启动子进程）的官方原文，只确认了它跑在 task runner 里。
- 没找到任何"在 n8n 里跑 `claude -p`"的第一手实测报告；Docker Desktop 在 Windows 上挂载目录的性能和权限问题也没查。
- SSH 节点是否在 n8n Cloud 可用、是否有超时，文档页没写。

## 说法 2："运行状态存在 n8n 自己的数据库里，不是文件，换工具或交给 AI 接手不方便"

### Takeaway
对"运行状态"属实：每次执行的记录、暂停等待中的状态、凭据都在数据库里（默认是一个 SQLite 文件），默认 14 天后清掉，也不能从文件恢复。对"流程定义"只对一半：工作流可以用命令行导出成 JSON 文件、再导入，AI 也能通过 MCP 读到完整工作流；但官方的 Git 同步功能不在免费社区版里。

### Cited Findings
- 【一手】"By default, n8n uses SQLite to save credentials, past executions, and workflows"，文件在 `~/.n8n/database.sqlite`；可改用 PostgreSQL（支持 17、18，16 兼容）。n8n Cloud 的 Starter、Pro 也是 SQLite。— [数据库配置文档](https://docs.n8n.io/hosting/configuration/supported-databases-settings.md)
- 【一手】二进制数据（图片、PDF 等文件内容）的存放方式只剩 `filesystem`（磁盘）、`database`、`s3` 三种，2.0 去掉了纯内存模式；3.0 把目录从 `~/.n8n/binaryData` 改名为 `~/.n8n/storage`。— [2.0 破坏性变更](https://docs.n8n.io/changelog/v20-breaking-changes.md)、[3.0 破坏性变更](https://docs.n8n.io/changelog/v30-breaking-changes.md)
- 【一手】执行记录默认会被清理：`EXECUTIONS_DATA_PRUNE` 默认 `true`，`EXECUTIONS_DATA_MAX_AGE` 默认 336 小时（14 天），`EXECUTIONS_DATA_PRUNE_MAX_COUNT` 默认 10000 条；`EXECUTIONS_DATA_SAVE_ON_PROGRESS`（每跑完一个节点就存一次进度）默认 `false`。— [执行相关环境变量](https://docs.n8n.io/hosting/configuration/environment-variables/executions.md)
- 【一手】Wait 节点（暂停等待）在等待超过 65 秒时，把执行数据存进数据库，条件满足后再读回来继续；恢复方式四种：过一段时间、到指定时刻、收到 webhook 调用（别的程序访问一个网址）、有人提交表单。— [Wait 节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait.md)
- 【一手】命令行可导出导入：`n8n export:workflow --all`、`--id=<ID> --output=file.json`、`--backup --output=backups/latest/`（`--separate` 时每个工作流一个文件）、`n8n import:workflow --input=file.json` 或 `--separate --input=目录`；还有 `export:credentials`、`export:entities` / `import:entities`。注意：导入可能覆盖同 ID 的现有内容；`import:entities` 要求数据库是空的。Docker 下要写成 `docker exec -u node -it <容器名> n8n ...`。— [CLI 命令文档](https://docs.n8n.io/hosting/cli-commands.md)
- 【一手】官方 Git 同步（source control）推送的是"workflows and tags, as well as credential and variable stubs"（工作流、标签，以及凭据和变量的空壳）；官方自己说"you shouldn't view n8n's source control as full version control"（别把它当完整的版本管理），不支持在 n8n 里做合并审阅，拉取会覆盖本地未入库的改动。— [Git 说明文档](https://docs.n8n.io/source-control-environments/understand/git.md)
- 【一手】社区版（免费自托管）不含的功能包括"Version control using Git"和"Environments"；免费注册后解锁的是 Folders、Debug in editor、Custom execution data。— [社区版功能说明](https://docs.n8n.io/hosting/community-edition-features.md)
- 【一手】定价页：Git 版本控制列在 Business（667€/月，按年付，仅自托管）和 Enterprise；Starter、Pro 不含。— [n8n 定价页](https://n8n.io/pricing)
- 【一手】通过官方 MCP，外部 AI 可以读：`get_workflow_details`（完整工作流，凭据只给 id 和名字）、`get_workflow_history` / `get_workflow_version` / `get_workflow_versions_diff`（历史版本及差异）、`get_workflow_execution`（默认只有元数据，`includeData: true` 时给出每个节点的结果数据）、`search_workflow_executions`。— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)
- 【一手】通过 MCP 创建工作流时用的不是 JSON 而是代码："Full TypeScript/JavaScript workflow code using the n8n Workflow SDK"。— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)

### Inferences
- 工作流定义可以做到"以文件为准"：定期 `export:workflow --backup` 到一个目录再自己 `git commit`，不需要付费的 Git 功能。但这是单向备份，数据库里那份才是 n8n 真正运行的；两边要靠人或脚本保持一致。
- 运行状态做不到"以文件为准"：某一站跑到哪、产出了什么、在等谁，全在数据库的执行记录里，而且默认 14 天后消失。要符合"每站的输入输出是固定位置、带状态的文件"这条设计标准，只能让每个节点自己显式写文件——那 n8n 的执行记录就成了第二份、且不是权威的那份。
- "交给 AI 接手"在 2026 年底比说法提出时容易得多：AI 不用读数据库，通过 MCP 就能读工作流、读执行结果、看版本差异。但这要求 n8n 服务开着，AI 不能只凭一个文件夹接手。
- "换工具"仍然难：导出的 JSON（以及 Workflow SDK 代码）是 n8n 专有格式，节点类型、表达式语法别的工具不认。

### Gaps
- 没核实"失败的执行能否从失败节点重试、用的是当时的流程还是现在的流程"；错误处理文档只提到执行数据里有 `execution.retryOf` 字段。
- 没核实社区版里"工作流历史版本"保留多久（定价页只写了 Starter 1 天、Pro 5 天、Enterprise 365 天以上）。
- 没核实 3.x 是否像第三方文章说的那样"引导用户从 SQLite 转 Postgres"；3.0 博客和变更页都没提数据库。— 二手说法见 [搜索摘要所引第三方升级指南](https://www.ayautomate.com/blog/n8n-3-0-upgrade-guide)

## 说法 3："AI 只是其中一种节点，不是流程的设计者；流程只有'下一步'，没有'验收不合格退回'"

### Takeaway
前半句在 2026 年底已经过时：n8n 自带的 n8n Assistant 能用对话创建、修改、测试、排错工作流，官方 MCP 服务还让 Claude Code、Codex CLI、Gemini CLI 这类外部代理直接创建、校验、试跑、发布工作流。后半句对一半：把连线接回前面的节点加一个 IF 判断，"不合格退回第 2 站"画得出来，人工审批和出错处理也有现成节点；但 n8n 里没有"门"这个一等概念（谁判、标准是什么、退回哪一站），这些只是你用通用节点拼出来的图形，Evaluations（评测）是线下测试工具，不是产线上的验收门。

### Cited Findings
- 【一手】n8n Assistant 是内置的对话式代理，能"create, edit, test, and troubleshoot workflows from natural language"，"can plan the workflow, build it in your selected project, test it, and help you fix errors"；发布、删除等高影响操作前会先问。可用范围：Cloud 的 Starter、Pro、Enterprise；自托管的 Community、Registered Community、Business、Enterprise；自托管时用"your own AI provider account"（自己的大模型账号），不消耗 Assistant 额度。官方提醒"n8n Assistant can make mistakes"，生成的工作流可能要人工检查和修正。— [n8n Assistant 文档](https://docs.n8n.io/build/ways-of-building-workflows/ai-assistant.md)
- 【二手】自托管用 Assistant 需要 2.36 及以后的版本并自带模型密钥（出自搜索摘要转述的官方博客，未读到原文）；Cloud 上线时版本是 2.29.9。— [官方博客：introducing n8n assistant](https://blog.n8n.io/introducing-n8n-assistant)、[论坛公告 302667](https://community.n8n.io/t/introducing-the-ai-assistant-the-workflow-building-agent-inside-n8n/302667)
- 【一手】Cloud 的 Assistant 额度：Starter 每月 1,600，Pro 每月 4,000 或 9,600（看套餐大小），每月 1 日重置，按模型处理的 token 量扣。— [n8n 定价页](https://n8n.io/pricing)、[n8n Assistant 文档](https://docs.n8n.io/build/ways-of-building-workflows/ai-assistant.md)；第三方给的数字不同（旧版 AI Workflow Builder 是 Starter 50、Pro 150；一份 2026-07 的第三方记录写 2,300 和 13,700）— [usagepricing 记录](https://usagepricing.com/blueprint/activity/n8n-2026-07-22-packaging)，以官方定价页为准。
- 【二手】更早的"AI Workflow Builder（Beta）"当时只在 Cloud 提供，自托管"还在探索"。— [论坛公告 204919](https://community.n8n.io/t/introducing-ai-workflow-builder-beta/204919)
- 【一手】官方实例级 MCP 服务（instance-level MCP server）：在 Settings > Instance-level MCP 打开，Cloud 和自托管都有；外部客户端能搜索工作流、触发和测试工作流、"create and edit workflows and data tables"；创建和编辑从 n8n 2.13.0 起可用。工作流要逐个标记"Available in MCP"才暴露完整内容；权限不按客户端区分，所有连上的客户端看到同一批工作流。— [连接 n8n MCP 服务文档](https://docs.n8n.io/connect/connect-to-n8n-mcp-server.md)
- 【一手】官方给出的接入命令：Claude Code 用 `claude mcp add --transport http n8n https://<域名>/mcp-server/http` 然后 `/mcp` 完成授权；Codex CLI 用 `codex mcp add n8n --url "https://<域名>/mcp-server/http"` 然后 `codex mcp login n8n`；Gemini CLI 用 `gemini mcp add --transport http n8n https://<域名>/mcp-server/http`。也支持用令牌（Bearer token）代替 OAuth 授权。— [MCP 客户端示例](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-client-examples.md)
- 【一手】MCP 里与"设计并验证"直接相关的工具：`get_workflow_sdk_reference`、`search_nodes`、`get_node_types`、`get_workflow_best_practices`（查资料）；`validate_workflow`（2.12.0+，"Always validate before creating or updating a workflow"）、`validate_node_config`（2.25.1+）；`create_workflow_from_code`（2.12.0+）、`update_workflow`（一次 1 到 100 个有序操作，如 `addNode`、`removeNode`、`addConnection`）、`archive_workflow`、`restore_workflow_version`（2.29.0+）；`prepare_workflow_pin_data` + `test_workflow`（用 pin data，即预先钉住的假数据，代替外部服务来试跑，同步等结果）；`execute_workflow`（真跑，立即返回执行编号，不等结束）+ `get_workflow_execution`（查结果）；`publish_workflow` / `unpublish_workflow`。— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)
- 【一手】MCP 试跑的限制：`test_workflow` 默认超时 300 秒，`timeout` 参数"Maximum 3600 (60 minutes)"，文档同时写强制的 MCP 执行超时"five minutes by default"；`execute_workflow` 的生产模式只支持 Webhook、Chat Trigger、Form Trigger、Schedule Trigger 四种触发节点，手动模式另支持 Manual Trigger；多步表单和 human-in-the-loop（流程中途等人操作）不支持；创建时凭据自动分配，但 HTTP Request 节点除外，要手工配。— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)
- 【一手】官方还有一个给编程代理用的技能包仓库 n8n-io/skills，文档称含"13 capability skills"。— [连接 n8n MCP 服务文档](https://docs.n8n.io/connect/connect-to-n8n-mcp-server.md)
- 【一手】社区项目 czlonkowski/n8n-mcp：MIT 许可，约 23.3k 星；7 个不需要连 n8n 的资料与校验工具，加 21 个需要 `N8N_API_URL` 和 `N8N_API_KEY` 的管理工具（如 `n8n_create_workflow`、`n8n_update_partial_workflow`、`n8n_validate_workflow`、`n8n_autofix_workflow`、`n8n_test_workflow`、`n8n_executions`）；它可以把官方内置 MCP 当第二后端。自述里的警告：工具会把整个工作流写回去，AI 操作期间你在界面上的手工修改会被覆盖；重要工作流先在副本上试。— [n8n-mcp 仓库](https://github.com/czlonkowski/n8n-mcp)
- 【一手】回环（退回）画得出来："To create a loop in an n8n workflow, connect the output of one node to the input of a previous node"，"Add an IF node to check when to stop the loop"。文档页没有关于死循环的警告。— [循环文档](https://docs.n8n.io/build/flow-logic/loop.md)
- 【二手】论坛上对回环有分歧：有回答说 n8n 不支持真正的环形连接，建议用 Loop 节点加 IF；也有人确认"IF 的 false 分支接回前面节点"可用，并用 `$runIndex`（第几轮）对比最大重试次数来防死循环；还有人做了第三方 do-while 节点，侧面说明原生写法不顺手。— [论坛帖 282493](https://community.n8n.io/t/circular-workflows-question/282493)、[论坛帖 148749](https://community.n8n.io/t/how-to-loop-between-nodes-not-items/148749)、[论坛帖 293944](https://community.n8n.io/t/new-community-node-n8n-nodes-do-while-the-missing-do-while-loop-for-n8n/293944.md)
- 【一手】出错处理：可在工作流设置里指定一个 error workflow（出错时自动跑的另一张图，以 Error Trigger 节点开头，能拿到执行编号、出错信息、最后执行的节点）；Stop And Error 节点可按你定的条件让执行强制失败。— [错误处理文档](https://docs.n8n.io/build/flow-logic/error-handling.md)
- 【一手】Evaluations（评测）：把一批测试数据跑过工作流来检查可靠性；分轻量（上线前，几个例子，肉眼比较）和按指标（上线后，较大数据集，打分）两种。文档没有把它描述成对线上每次执行的实时把关。— [Evaluations 概览](https://docs.n8n.io/advanced-ai/evaluations/overview.md)
- 【二手】人工把关：Slack 等节点有"Send and Wait for Response"操作，Response Type 可选 Approval（批准或拒绝）；AI Agent 节点可以给某个工具加"human review step"，工具执行前暂停等人批。均为官方文档页，但本次只读到搜索摘要。— [Slack 审批文档](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.slack/approvals.md)、[工具调用的人工审核文档](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools)
- 【一手】3.0 移除了 Chat Hub（默认关闭），官方说"the n8n AI assistant and agents are replacing it"；3.1 加了 n8n Assistant 的总开关。— [3.0 官方博客](https://blog.n8n.io/introducing-n8n-v3)、[发布日志](https://docs.n8n.io/release-notes.md)

### Inferences
- "AI 只是节点、不是设计者"已不成立。现在有两条路让 AI 当设计者：n8n 自带的 Assistant（背后是 n8n 或你自己的模型账号），以及外部代理经 MCP 操作。后者正好对上"入口是 Claude Code、可换别家"的需求。
- "AI 自己验证跑通"是部分成立：`validate_workflow` 查的是结构，`test_workflow` 用的是假数据替身（外部服务没真调），只有 `execute_workflow` 的手动模式才是真跑，而它异步返回、要自己轮询，且中途有人工步骤或多步表单的流程经 MCP 跑不了。所以"端到端真跑通"对含人工门的产线做不到全自动。
- "验收不合格退回"在 n8n 里是画法，不是概念：IF 加回连线能表达"退回第 2 站"，但"谁来判、合格标准、最多退几次"都散落在 IF 的条件表达式和你自己的约定里，图上看不出某个 IF 是"门"还是普通分支。AI 设计时也不会被系统强制"每站必须有门"。
- Evaluations 最接近"合格标准"的概念，但它检查的是"这张图对一批样例表现如何"，不是"这一件半成品能不能过这一站"。

### Gaps
- MCP 工具清单页很长（约 26 万字符），只读了前 20 万字符；数据表、用户偏好等工具和页尾内容没读到。
- 没核实公开 REST API（用网址和密钥直接调 n8n 的编程接口）当前的工作流和执行相关端点；抓到的 API 页只有用户管理部分。尤其"REST API 有没有直接执行工作流的端点"未核实，本笔记不作结论。— 尝试的页面：[API 参考](https://docs.n8n.io/api/api-reference.md)
- 没核实实例级 MCP 在社区版是否有功能删减；文档只说 Cloud 和自托管都能开，社区版"不含功能"清单里没列 MCP。
- 没核实 Evaluations 在各套餐的限制（例如社区版是否只能给一个工作流建评测）。
- 没读到节点级"Retry On Fail"（失败自动重试）和"On Error"（出错后继续或走错误分支）设置的官方原文。
- 旧"AI Workflow Builder"与现"n8n Assistant"是否就是改名关系，官方页没明说。

## 说法 4："必须养一个常驻服务（安装、升级、备份）"

### Takeaway
属实，而且 3.0 之后门槛更高：自托管只支持 Docker，等于在 Windows 上先装并常开 Docker Desktop，再开 n8n 容器。命令行有 `n8n execute --id` 可以不开服务跑一次已存在数据库里的工作流，但没查到"拿一个流程文件直接跑完就退出"的模式。n8n Cloud 最低 20€/月（按年付）可以免运维，但 Cloud 上没有 Execute Command、文件也只能碰容器里一个目录，对"碰本机程序和文件"的需求没用。个人自用在许可上没有问题，免费。

### Cited Findings
- 【一手】3.0："Self-hosted n8n now runs on Docker"，npm 与 `npx n8n` 不再支持；替代的快速安装是一行脚本 `curl -fsSL https://get.n8n.io | sh`；升级前要先看 Settings > Migration Report（迁移报告）。3.0.0 beta 于 2026-10-27 发布，"the stable release follows in early December"；稳定版发布后 2.x"gets security and critical bug fixes for 12 months"。博客没提 Windows 用户怎么办。— [3.0 官方博客](https://blog.n8n.io/introducing-n8n-v3)、[3.0 破坏性变更](https://docs.n8n.io/changelog/v30-breaking-changes.md)
- 【一手】3.0 一并移除了大量旧节点（Function、Function Item、Item Lists、Cron、Interval、Read/Write Binary File 等），用到它们的已发布工作流将无法激活；即"升级"本身是要花功夫的事。— [3.0 破坏性变更](https://docs.n8n.io/changelog/v30-breaking-changes.md)
- 【一手】2.x 下 npm 路线：`npx n8n` 可免安装试用，`npm install -g n8n` 后用 `n8n` 或 `n8n start` 启动，升级用 `npm update -g n8n`，编辑器在 localhost:5678。— [npm 安装文档](https://docs.n8n.io/hosting/installation/npm.md)
- 【一手】命令行：`n8n execute --id <ID>`（"You can start workflows directly using the CLI"）；文档称服务端 CLI"can execute most commands even when n8n isn't running"（多数命令在 n8n 没运行时也能执行）；发布用 `n8n publish:workflow --id=<ID>`，某些配置下发布后要"restart n8n to apply the change"；已知问题：非多主模式下，之前激活的定时触发会一直跑到重启。— [CLI 命令文档](https://docs.n8n.io/hosting/cli-commands.md)
- 【一手】定价（官方页，欧元，按年付的月均价）：Starter 20€/月，2,500 次执行，5 个并发；Pro 50€/月，10,000 次执行；Business 667€/月，40,000 次执行，仅自托管；Enterprise 面议。"Pricing is based on monthly workflow executions, regardless of complexity"（按每月执行次数计费，不管流程多复杂）。实例级 MCP 在 Starter、Pro、Enterprise 列为包含。社区版在定价页只有一句"A standard, self-hosted version of n8n is available on GitHub"。— [n8n 定价页](https://n8n.io/pricing)
- 【二手】按月付的价格约为 Starter 24€、Pro 60€。— [jetadmin 定价梳理（2026-09-26）](https://www.jetadmin.io/blog/n8n-pricing/)
- 【一手】许可（Sustainable Use License，可持续使用许可，只适用于自托管版）：个人项目、学习、研究、公司内部使用免费；不允许把 n8n 当服务托管给客户搭流程、不允许让外部最终用户通过你的产品搭建或配置工作流（包括由 AI 代理替他们操作）、不允许去掉品牌白标转售、不允许在没有企业许可的情况下使用需要许可密钥的企业功能。— [许可常见问题](https://docs.n8n.io/n8n-community-license/community-license/license-faq.md)
- 【一手】备份面：默认 SQLite 文件 `~/.n8n/database.sqlite` 加二进制数据目录（3.0 起 `~/.n8n/storage`）；3.0 默认开启加密密钥轮换。— [数据库配置文档](https://docs.n8n.io/hosting/configuration/supported-databases-settings.md)、[3.0 破坏性变更](https://docs.n8n.io/changelog/v30-breaking-changes.md)

### Inferences
- 对"个人自用、不卖不分享"，许可完全放行；即使是"AI 代理替我搭流程"也属于自己用，不触犯"让外部用户通过 AI 代理搭建"那条禁令。
- 定时触发、webhook、Wait 节点的恢复、MCP 接口都要求服务常开；`n8n execute --id` 只覆盖"手动点一下跑一次"这种最简单的情形，而且流程必须先导入数据库。所以"投料即出货"的产线离不开常驻服务。
- 养服务的实际清单（3.x、Windows）：Docker Desktop 常开；n8n 容器及其数据卷；想碰本机文件要配挂载和 `N8N_RESTRICT_FILE_ACCESS_TO`；想跑本机命令要改 `NODES_EXCLUDE` 并处理"容器里没有那个程序"；每次大版本升级前跑迁移报告；自己备份数据库文件和导出的工作流。
- 留在 2.x 的 npm 路线能把这份清单砍掉一半，但那是一条有明确终点的路：按官方说法大约维护到 2027 年 12 月前后（3.x 稳定版发布后 12 个月）。
- Cloud 省掉运维但与本需求的核心（驱动本机 CLI 代理、读写本机固定位置的文件）冲突，所以对这位用户 Cloud 不是可选项，而不只是贵不贵的问题。

### Gaps
- `n8n execute --id` 是否必须在服务停着的时候跑、与正在运行的实例是否冲突，文档没明说；3.x 下它是否只能经 `docker exec` 在容器里跑，也没读到明文。
- 有没有"直接执行一个流程文件"的命令行模式（例如 `--file`）未核实，当前 CLI 文档里没列出。
- 发布日志只读了前 10 万字符；3.x 稳定版确切日期只有"12 月初"这一句。
- Windows 上 Docker Desktop 的许可和资源占用没查。

## 八条需求逐条打分

### Takeaway
八条里，4（看得见）、6（可反复跑）、7（自用）、8（可手改）是 n8n 的强项，直接满足；1、2、3 靠 2026 年新出的官方 MCP 和 n8n Assistant 从"不满足"变成了"部分满足到基本满足"；5（不受四条限制）不满足，因为说法 1、4 仍然成立且在 3.0 更严，说法 2 对运行状态成立。

### Cited Findings
- 需求 1（入口是对话框，背后是 Claude Code，可换别家命令行代理）：**部分满足，接近满足**。n8n 官方 MCP 服务给了 Claude Code、Codex CLI、Gemini CLI 三家的接入命令，换代理只是换一条命令。但"对话框"是这些代理自己的终端，不是 n8n 的；n8n 自带的对话入口（n8n Assistant）背后不是 Claude Code。【一手】— [MCP 客户端示例](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-client-examples.md)、[n8n Assistant 文档](https://docs.n8n.io/build/ways-of-building-workflows/ai-assistant.md)
- 需求 2（用户只给两头，中间几站、每站干什么不归用户管）：**部分满足**。Assistant 能"plan the workflow, build it"，MCP 提供 `get_workflow_best_practices`、`search_nodes` 等让外部代理自己规划；但官方承认 Assistant 会出错、可能比预期更频繁地反问、生成的工作流可能要人工修正；用 MCP 创建时 HTTP Request 节点的凭据要手工配。【一手】— [n8n Assistant 文档](https://docs.n8n.io/build/ways-of-building-workflows/ai-assistant.md)、[MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)
- 需求 3（AI 设计并自己验证端到端跑通）：**部分满足**。有 `validate_workflow`（查结构）、`test_workflow`（假数据试跑，同步，默认 300 秒、最长 3600 秒）、`execute_workflow` 手动模式加 `get_workflow_execution`（真跑并取每个节点的结果）。缺口：多步表单和人工介入步骤经 MCP 跑不了；真跑是异步的，要代理自己轮询。【一手】— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)
- 需求 4（结果可视化，用户看得见流程的样子）：**满足**。n8n 的本体就是一张可视的节点连线图，AI 经 MCP 创建的工作流直接出现在编辑器里；`update_workflow` 还支持 node group（给一组节点加框和说明，说明上限 145 字符）。【一手】— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)
- 需求 5（不受 n8n 那四条限制）：**不满足**。说法 1 属实且 3.0 后更严（只能 Docker，命令在容器里跑）；说法 2 对运行状态属实（执行记录在数据库，默认 14 天清理）；说法 4 属实；只有说法 3 的前半句已过时。【一手】— [3.0 破坏性变更](https://docs.n8n.io/changelog/v30-breaking-changes.md)、[Execute Command 节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executecommand.md)、[执行相关环境变量](https://docs.n8n.io/hosting/configuration/environment-variables/executions.md)
- 需求 6（可反复跑，每次投料都出货）：**满足，但以常驻服务为前提**。工作流发布后由触发节点（定时、webhook、表单等）反复启动；2.0 起"保存"与"发布"分开，改动不发布不生效。【一手】— [2.0 破坏性变更](https://docs.n8n.io/changelog/v20-breaking-changes.md)、[CLI 命令文档](https://docs.n8n.io/hosting/cli-commands.md)
- 需求 7（只自用，不卖不分享）：**满足**。Sustainable Use License 明确允许个人项目和内部使用免费。【一手】— [许可常见问题](https://docs.n8n.io/n8n-community-license/community-license/license-faq.md)
- 需求 8（图可以手改，但主要是用户提意见、AI 来改）：**满足，有一个并发坑**。手改是 n8n 编辑器的本职；AI 改图有官方 `update_workflow`（增删节点和连线的原子操作）和历史版本回退 `restore_workflow_version`。坑：社区版 n8n-mcp 自述说它把整个工作流写回，AI 操作期间用户在界面上的手改会被覆盖。【一手】— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)、[n8n-mcp 仓库](https://github.com/czlonkowski/n8n-mcp)

### Inferences
- 一句话概括：n8n 在"看得见、可重跑、AI 能替你画并试跑"这几条上已经很强，输在"本机"和"文件"这两个字上——恰好是这位用户设计标准的地基。
- 需求 4 和 8 是自己造工具时最贵的两条（画布和手工编辑器），n8n 白送；需求 5 是 n8n 给不了的。所以取舍的实质是：要不要为了白拿画布，接受一个常驻的、以数据库为准、关在容器里的运行时。
- 官方 `update_workflow` 是按操作增量修改，理论上比"整份写回"更不容易覆盖手改，但官方文档没有说明并发编辑时的行为，不能当作已解决。

### Gaps
- 需求 2、3 的实际质量（AI 只拿到"两头"时，一次做对的比例）没有任何第一手数据，只有官方"会出错、需复核"的免责表述。
- 社区版保留多少历史版本未核实，影响需求 8 里"AI 改坏了能否退回"。

## 现实中的"Claude Code 驱动 n8n"长什么样，离需求和设计标准还差什么

### Takeaway
现实做法是：本机常开一个 n8n（3.x 要 Docker），打开实例级 MCP，用一条命令把 Claude Code 接上；用户在 Claude Code 里说两头，Claude Code 查节点资料、写流程、校验、试跑、读结果、改到通过，用户在浏览器里看图提意见。这条路今天就能走通，但产出的是"n8n 式的线"：站与站之间传的是内存里的数据而不是文件，状态在数据库，门和退回是拼出来的，没有退场条件，而且线上每一站想调本机的 `claude -p` 还得另想办法。

### Cited Findings
- 【一手】接入一步到位：n8n 里 Settings > Instance-level MCP > Enable MCP access，给工作流打开"Available in MCP"；Claude Code 侧 `claude mcp add --transport http n8n https://<域名>/mcp-server/http`，再 `/mcp` 授权（本机实例用 `http://`）。换 Codex CLI、Gemini CLI 各是一条对应命令。— [连接 n8n MCP 服务文档](https://docs.n8n.io/connect/connect-to-n8n-mcp-server.md)、[MCP 客户端示例](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-client-examples.md)
- 【一手】一轮"设计到验证"的工具顺序（官方文档给出的用法）：先 `get_workflow_sdk_reference`（"Should be called before building workflows"）→ `search_nodes` / `get_node_types` → 写 Workflow SDK 代码 → `validate_workflow` → `create_workflow_from_code` → `prepare_workflow_pin_data` + `test_workflow` 或 `execute_workflow`（manual 模式）→ `get_workflow_execution`（`includeData: true`）看每个节点的结果 → `update_workflow` 修 → 用户确认后 `publish_workflow`。— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)
- 【一手】可叠加的辅助：官方技能包 n8n-io/skills（13 个能力技能）；社区 n8n-mcp（节点资料库、`n8n_autofix_workflow` 自动修、编辑前自动留快照，每个工作流最多 10 份）及配套 n8n-skills。— [连接 n8n MCP 服务文档](https://docs.n8n.io/connect/connect-to-n8n-mcp-server.md)、[n8n-mcp 仓库](https://github.com/czlonkowski/n8n-mcp)
- 【一手】要让线上的站能碰本机，需要改的默认值：`NODES_EXCLUDE="[]"`（放开 Execute Command 和 Local File Trigger）、`N8N_RESTRICT_FILE_ACCESS_TO`（放开 `~/.n8n-files` 以外的目录）；Docker 下还要挂载目录，并解决容器里没有目标程序的问题（官方建议自制镜像）。— [2.0 破坏性变更](https://docs.n8n.io/changelog/v20-breaking-changes.md)、[Read/Write Files 节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.readwritefile.md)、[Execute Command 常见问题](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executecommand/common-issues.md)
- 【一手】MCP 侧的硬限制：强制执行超时默认 5 分钟；多步表单和人工介入不能经 MCP 执行；访问不按客户端隔离。— [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)、[连接 n8n MCP 服务文档](https://docs.n8n.io/connect/connect-to-n8n-mcp-server.md)
- 【二手】社区里确有"Claude Code + MCP 能在 n8n 上管到多深"的讨论，早期（创建编辑功能上线前）的结论是只能发现和执行已暴露的工作流，现已过时。— [论坛帖 258289](https://community.n8n.io/t/clarifying-how-far-claude-code-mcp-can-create-manage-workflows-on-n8n-cloud/258289)

### Inferences
对照设计标准，还差的东西：

- **半成品是文件**（每站的输入输出是固定位置、带状态的文件）：n8n 不是这样工作的。节点之间传的是内存里的数据条目，落盘的只有数据库里的执行记录。要达标，必须让每一站显式"读文件 → 干活 → 写文件 → 写状态"，这在 n8n 里可以搭，但等于绕开 n8n 自己的数据传递，n8n 只剩"画布加调度器"的作用；并且每次读写都要经过文件访问白名单和容器挂载。
- **每站一道门**（格式、谁判、合格标准）：没有一等概念。能用 IF、Code、Stop And Error、Send and Wait 审批拼出来，但图上分不出"门"和普通分支，系统也不会检查"是否每站都有门"。AI 设计时要靠提示词或技能包里的约定来保证，n8n 不替你把关。
- **退回路**（不合格退回指定的上游站）：能画（IF 的一支接回前面的节点），需要自己加轮数上限。跨工作流的退回、带着"退回原因"的退回，都得自己设计数据怎么带。
- **退场条件**（这条线什么时候拆）：n8n 没有这个概念，只能写在便签或工作流描述里（描述超过 255 字符会被截断），不会被系统执行或提醒。
- **状态不存在对话或数据库里**：直接冲突。等待中的人工门（Wait、审批）其状态就在数据库里；换工具时带不走。
- **线上的站调用本机命令行代理**：2.x 加 npm 装在 Windows 上最顺（Execute Command 在 `cmd` 里直接跑，节点无超时）；3.x 加 Docker 则要自制镜像或 SSH 回宿主机。并且 Execute Command 没有"工作目录"参数，要在命令里自己 `cd`；Windows 多行命令还有"只执行第一行"的坑。
- **AI 自验证的盲区**：含人工门的线，AI 经 MCP 无法端到端真跑（人工介入不支持）；超过 5 分钟的站要调超时或改成"启动后轮询"。而这位用户的线偏偏"每站一道门"且可能含人判的门、站内可能是跑很多分钟的代理。
- **双层代理的成本**：设计时 Claude Code 经 MCP 操作 n8n；运行时 n8n 的某一站再去启动 `claude -p`。两层都要认证、都要处理失败，调试时要同时看 Claude Code 的对话、n8n 的执行记录和站内代理自己的输出，三处状态。
- 如果只想借 n8n 的画布做"审图"而不用它的运行时，可以考虑反过来：线本身用文件和脚本实现，另外生成一张图给用户看。这超出本笔记范围，只是指出 n8n 的画布和运行时是捆绑的，官方没有"只用画布"的用法（未见相关文档）。

### Gaps
- 没有找到任何公开的、完整的"Claude Code 经官方 MCP 从零设计、试跑、交付一条含本机命令站的 n8n 工作流"的第一手实录，上面的流程是按官方工具说明拼出来的，没有实测。
- 官方 MCP 与用户在画布上同时编辑时谁覆盖谁，官方文档未说明。
- n8n-io/skills 仓库的具体内容没读。
- 3.x 稳定版（预计 12 月初）是否会调整 MCP、Execute Command 或文件访问的默认值，目前无从得知。
