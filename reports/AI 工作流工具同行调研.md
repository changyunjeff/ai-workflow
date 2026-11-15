# 现成工具都缺同一块：在 Claude Code 上加薄层

> **更正说明（2026-11-14，盲审之后）**：本报告的结论以 `docs/02-同行调研结论.md` 为准。下面三处已被推翻或降级，正文未改：
>
> 1. "发动机自己写"不是定论。报告没有评估"Claude Code 当设计者 + 现成发动机（microsoft/conductor 或 Archon）"这个组合，现在是待动手对比。
> 2. 对照表里 microsoft/conductor 一行"不能正式用 Claude Code 或 Codex 命令行当工人"是错的。它的说明文档写明有脚本步骤，能跑任意本机命令并按结果分流。
> 3. "五十来个现成工具里没有一个"说得过满。这是"查过的里面没找到"，多处依据是"文档没提"，且全部没有实测。
>
> n8n 四条限制的判定经盲审抽查官方页面，全部一致，可以照用。

结论先说：三个选项里选第二个，**在现成底座上加一薄层**。底座是 Claude Code 本身，由它当对话框、当流程的设计者、也当每一站干活的工人；不选 n8n，也不选任何一个搭流程的平台。薄层是四样要自己做的小东西：一份写明"分几站、每站的门、不合格退回哪一站、这条线什么时候拆"的产线定义文件，每件活一份的状态文件，一个逐站调用命令行工具并判门的小运行程序，一张从定义文件自动生成的流程图。这样选有两层依据。其一，n8n 的四条限制查下来**三条属实、一条的前半句已经过时**：碰本机别扭、运行状态在数据库、要养常驻服务都成立，而且 2026 年 10 月发布测试版的 n8n 3.0 让第一条和第四条更严；"AI 只是节点"已不成立，因为现在 Claude Code 能直接替你在 n8n 里搭流程和试跑。其二，调研覆盖的五十来个现成工具里**没有一个同时满足八条需求**，更没有一个符合设计标准：能画图的平台把状态放数据库、没有"门"；有门有退回的工具要么没有图、要么状态在数据库；状态是文件的工具不许流程回头。最大的不确定点是这一切都来自读文档，没有一样在这台 Windows 11 电脑上跑过，"薄层大约五百到九百行程序"只是笔记里的估计。拍板前值得动手验证两件事：用一条两三站的小样线试出薄层到底有多薄、在 Windows 上稳不稳；再看"图自动生成，想改就提意见或改文本"这种改图方式你能不能接受。

## n8n 的四条限制：三条属实，一条的前半句已经过时

n8n 是一个把流程画成方块连线图的自动化工具，图上每个方块叫节点，做一步操作。查证时它正处在换代期：3.0 版在 2026-10-27 以测试版发布，官方说稳定版在 12 月初，下面每条都注明是哪个版本的事（[3.0 官方博客](https://blog.n8n.io/introducing-n8n-v3)）。

| 说法 | 结论 | 一句话依据 |
|---|---|---|
| ① 碰本机的程序和文件别扭 | **属实，3.0 起更别扭** | 跑本机命令的节点默认关闭；3.0 起只能装在 Docker 里，命令在隔离环境里跑，看不到 Windows 上的程序 |
| ② 运行状态在它自己的数据库里 | **对运行状态属实；对流程定义只对一半** | 运行记录、暂停等人的状态都在数据库，默认 14 天清掉；流程定义能导出成文本文件 |
| ③ AI 只是节点、不是设计者；只有"下一步"，没有"验收、退回" | **前半句已过时；后半句对一半** | AI 现在能替你搭和试跑；"退回"画得出来，但没有"门"这个概念 |
| ④ 要养一个常驻服务 | **属实，3.0 起门槛更高** | 在 Windows 上等于先常开 Docker Desktop，再开 n8n |

**第一条属实，而且越来越别扭。** n8n 里能跑本机命令的节点叫 Execute Command，只在自装版（装在自己电脑上的免费版）里有，官方托管的付费云版里没有；从 2.0 版起默认关闭，要改配置才能打开（[Execute Command 文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executecommand.md)、[2.0 破坏性变更](https://docs.n8n.io/changelog/v20-breaking-changes.md)）。读写本机文件的节点从 2.0 起默认只能碰一个指定目录（[Read/Write Files 文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.readwritefile.md)）。更关键的是 3.0：**自装版只支持 Docker**，以前直接装在 Windows 上的 npm 安装方式不再支持（[3.0 破坏性变更](https://docs.n8n.io/changelog/v30-breaking-changes.md)）。Docker 是把程序关进一个隔离"集装箱"里运行的工具，集装箱里是一套小型 Linux 系统，默认看不到外面 Windows 上装的程序和文件；官方文档明说，用 Docker 时命令在集装箱里执行，不在你的电脑上（[Execute Command 文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executecommand.md)）。由此得出的判断是：在 3.x 上，n8n 的一站碰不到 Windows 里装的 `claude` 命令，除非自己改造集装箱或绕道远程登录回本机。这一句是笔记的推断，调研没有找到任何人在 n8n 里实际跑 `claude -p` 的第一手记录。留在 2.x、用旧方式装在 Windows 上是目前最顺的路，Execute Command 节点本身也没有时间限制（[节点源码](https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/ExecuteCommand/ExecuteCommand.node.ts)），但官方只承诺 3.x 稳定版发布后再给 2.x 修 12 个月的安全问题和严重缺陷（[3.0 官方博客](https://blog.n8n.io/introducing-n8n-v3)），这是一条有终点的路。

**第二条对"运行状态"属实，对"流程定义"只对一半。** n8n 默认把凭据、历次运行记录和流程本身都存在一个数据库文件里（[数据库配置文档](https://docs.n8n.io/hosting/configuration/supported-databases-settings.md)）；运行记录默认 **14 天后自动清理**（[执行相关环境变量](https://docs.n8n.io/hosting/configuration/environment-variables/executions.md)）；流程中途暂停等人时，等待中的状态也存进数据库（[Wait 节点文档](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait.md)）。流程定义倒是能用命令导出成文本文件再导入（[CLI 命令文档](https://docs.n8n.io/hosting/cli-commands.md)），只是官方的 Git 同步（把流程自动存进版本库）不在免费版里，列在按年付每月 667 欧元的 Business 档（[社区版功能说明](https://docs.n8n.io/hosting/community-edition-features.md)、[定价页](https://n8n.io/pricing)）。"让 AI 接手"比这条说法提出时容易了：AI 可以通过 MCP（一种让外部 AI 调用某个软件功能的通用接口）读到完整流程和运行结果（[MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)）。但这要求 n8n 服务开着，AI 不能只凭一个文件夹接手，这一点是笔记的推断。

**第三条前半句已经过时，后半句对一半。** n8n 自带的对话助手 n8n Assistant 能用大白话创建、修改、测试、排错流程（[n8n Assistant 文档](https://docs.n8n.io/build/ways-of-building-workflows/ai-assistant.md)）；官方的 MCP 服务还让 Claude Code、Codex CLI、Gemini CLI 各用一条命令接进来，直接创建、校验、试跑、发布流程（[MCP 客户端示例](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-client-examples.md)）。所以 AI 已经可以是设计者。至于"退回"，官方文档说把后面节点的输出连回前面的节点、再加一个判断节点决定何时停，就能画出回头路（[循环文档](https://docs.n8n.io/build/flow-logic/loop.md)）。但 n8n 里没有"门"这种东西：谁来判、合格标准是什么、最多退几次，都散在你自己拼的判断条件里，图上分不出哪个判断是验收、哪个只是普通分岔；它的 Evaluations（评测）是拿一批样例测流程的工具，文档没有把它描述成对每次运行的实时把关（[Evaluations 概览](https://docs.n8n.io/advanced-ai/evaluations/overview.md)）。还有一个对你要紧的盲区：AI 经 MCP 试跑时，**中途要等人操作的流程跑不了**，试跑默认 5 分钟超时、最长可调到 60 分钟（[MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md)）。而你的线偏偏每站一道门、可能有人判的门、一站可能跑很多分钟。

**第四条属实，3.0 之后门槛更高。** 在 Windows 上用 3.x，等于先装并常开 Docker Desktop，再开 n8n 的集装箱。命令行里有 `n8n execute --id` 可以直接启动一条已存进数据库的流程，官方文档称多数命令在服务没开时也能执行（[CLI 命令文档](https://docs.n8n.io/hosting/cli-commands.md)）；"拿一个流程文件直接跑完就退出"的用法没有查到。官方云版最低每月 20 欧元（按年付）可以免掉运维（[定价页](https://n8n.io/pricing)），可云版没有 Execute Command，对"碰本机"毫无帮助。个人自用在许可上没有问题，免费（[许可常见问题](https://docs.n8n.io/n8n-community-license/community-license/license-faq.md)）。

四条合起来看，n8n 在"看得见、能反复跑、AI 能替你画并试跑"上已经很强，输在"本机"和"文件"两个词上，而这两个词恰好是你设计标准的地基。

## 五十来个现成工具，没有一个同时满足八条

调研分三路看了三类工具：对话式搭流程平台、命令行代理及社区编排器、文件式流水线与编排引擎。下表挑出每类里最相关的列出来。记号：✔ 满足；◐ 部分满足；✘ 不满足；？ 没查到；— 这类工具不管这件事（它只是发动机，对话、设计、验证都得靠外面的 AI 来做）。最后三行的工具，笔记没有按八条逐条打分，表里是本报告依据笔记事实作的判定。

| 工具 | 1 对话入口、可换别家 | 2 只给两头 | 3 AI 设计并自己验证 | 4 看得见 | 5 不受四条限制 | 6 反复跑 | 7 自用 | 8 图可手改 | 最要命的一条 | 来源 |
|---|---|---|---|---|---|---|---|---|---|---|
| n8n（由 Claude Code 经官方 MCP 驱动） | ◐ | ◐ | ◐ | ✔ | ✘ | ✔（要常驻服务） | ✔ | ✔ | 运行状态在数据库；3.0 起关在 Docker 里碰不到本机 | [MCP 工具清单](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-server-tools-reference.md) |
| Dify | ◐（经 difyctl 命令行） | ◐ | ◐ | ✔ | ✘ | ✔ | ✔ | ✔ | 一整套 Docker 常驻服务；命令在 Linux 隔离环境里跑 | [Dify CLI](https://docs.dify.ai/en/cli/build-apps)、[README](https://github.com/langgenius/dify) |
| Flowise | ✘ | ◐ | ✘/？ | ✔ | ✘ | ✔ | ✔ | ◐ | 2026 年 8 月已停止维护 | [sunset](https://flowiseai.com/sunset) |
| Langflow | ◐（经 lfx-mcp） | ◐ | ◐ | ✔ | ✘（本机、免服务各算半个；状态和门不行） | ✔ | ✔ | ✔ | 没见到审批、退回、验收门；助手不替你试跑 | [lfx-mcp](https://docs.langflow.org/lfx-mcp)、[Assistant 文档](https://docs.langflow.org/langflow-assistant) |
| OpenAI Agent Builder | ✘ | ✘ | ✘ | ✔ | ✘ | ✘ | ✘ | ◐（只能手改） | 2026-11-30 关停 | [deprecations](https://developers.openai.com/api/docs/deprecations) |
| Sim | ◐（MCP、命令行、技能包） | ◐ | ◐（接近 ✔） | ✔ | ✘ | ✔ | ✔ | ✔ | 自装要 5 个常驻服务；命令只能在远程隔离环境里跑 | [Sim API](https://docs.sim.ai/api-reference/build-and-run-workflows)、[Docker](https://docs.sim.ai/platform/self-hosting/docker) |
| Activepieces | ◐（经 MCP） | ◐ | ◐ | ✔ | ✘ | ✔ | ✔ | ✔ | 要 Docker；它的审批管的是"发布"，不是运行中的验收 | [MCP](https://www.activepieces.com/docs/mcp/overview) |
| Zapier | ◐（MCP 建流程是早期体验） | ◐ | ✘ | ✔ | ✘ | ✔ | ✔ | ✔ | 纯云，碰不到本机；官方让用户自己测试 | [Copilot 最佳实践](https://help.zapier.com/hc/en-us/articles/45327353705997-Best-practices-for-using-Zapier-Copilot) |
| Make | ◐（MCP 可改流程，付费） | ◐ | ◐ | ✔ | ✘ | ✔ | ✔ | ✔ | 纯云，碰不到本机 | [Maia](https://help.make.com/introduction-to-maia-by-make)、[Make MCP](https://developers.make.com/mcp-server) |
| Claude Code 动态工作流 | ◐（工人只能是 Claude） | ✔ | ◐ | ◐偏✘（有进度树，没有流程图） | ◐ | ✔ | ✔ | ✘ | 运行中不能停下等人；没有图 | [workflows 文档](https://code.claude.com/docs/en/workflows.md) |
| Archon | ◐ | ✘（线要人写） | ✘ | ◐ | ◐ | ✔ | ✔ | ✘ | 状态在数据库；AI 不是设计者 | [README](https://raw.githubusercontent.com/coleam00/Archon/main/README.md) |
| microsoft/conductor | ◐（Claude Code 接入是实验性） | ✘ | ✘ | ✔偏◐（实时流程图，只读） | ◐ | ✔ | ✔ | ✘ | 线要人写；不能正式用 Claude Code 或 Codex 命令行当工人 | [README](https://raw.githubusercontent.com/microsoft/conductor/main/README.md) |
| CC Workflow Studio | ◐（入口在 VS Code） | ◐ | ✘ | ◐（有形状，看不到运行位置） | ◐ | ◐ | ✔ | ✔ | README 没提门、状态和运行监控 | [README](https://raw.githubusercontent.com/breaking-brake/cc-wf-studio/main/README.md) |
| babysitter | ◐ | ？ | ◐ | ◐（有监控界面，没有流程图） | ✔偏◐ | ✔ | ✔ | ✘ | 没有流程形状图；流程要写成程序代码 | [README](https://raw.githubusercontent.com/a5c-ai/babysitter/main/README.md) |
| Snakemake、DVC | — | — | —（自带的自检命令可借） | ◐（只出静态结构图） | ◐ | ✔ | ✔ | ✘（改文本文件） | 流程不许回头，画不出"退回"；没有人判的门 | [Snakemake FAQ](https://snakemake.readthedocs.io/en/stable/project_info/faq.html)、[DVC](https://doc.dvc.org/user-guide/pipelines/defining-pipelines) |
| Kestra | — | — | — | ◐（有界面，要开着服务） | ✘ | ✔ | ✔ | ◐（界面里的修改写回文本文件） | 是常驻服务，状态在数据库 | [Windows 安装](https://kestra.io/docs/installation/windows)、[仓库](https://github.com/kestra-io/kestra) |
| LangGraph | — | — | — | ◐（能出图；好看的界面在厂商网站上） | ◐ | ✔ | ✔ | ✘（改程序代码） | 状态在它自己的库里；流程定义是程序 | [persistence](https://docs.langchain.com/oss/python/langgraph/persistence)、[graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) |

**对话式搭流程平台：会画已是标配，会自己验证的很少，把本机命令当正经一站的一个没有。** 到 2026 年 11 月，几乎每家都有"说一句话生成流程"的功能，但官方明确写出"自己搭、自己跑、自己找错、自己修、再跑"的只有 n8n Assistant（[n8n 官方博客](https://blog.n8n.io/introducing-n8n-assistant)）；Sim 写的是能建、能测、能调试，但要你检查它提出的修改和验证结果（[Sim Chat](https://docs.sim.ai/chat/workflows)）；Zapier 明说测试要用户自己做（[Copilot 最佳实践](https://help.zapier.com/hc/en-us/articles/45327353705997-Best-practices-for-using-Zapier-Copilot)）。两个代表产品在今年退场：**OpenAI Agent Builder 定于 2026-11-30 关停**（[deprecations](https://developers.openai.com/api/docs/deprecations)），**Flowise 已在 2026 年 8 月停止维护并归档**，官方给的理由正是 Claude Code 这类编码代理兴起、低代码流程碰到了复杂度天花板（[Flowise sunset](https://flowiseai.com/sunset)）。与此同时，Dify、Langflow、Sim、Activepieces 四家都开了官方通道，让 Claude Code 从外面替你搭流程和测流程（[Dify CLI](https://docs.dify.ai/en/cli/build-apps)、[lfx-mcp](https://docs.langflow.org/lfx-mcp)、[Sim API](https://docs.sim.ai/api-reference/build-and-run-workflows)、[Activepieces MCP](https://www.activepieces.com/docs/mcp/overview)），需求 1 在这些平台上只能这样绕着满足。真正过不去的是本机。纯云的 Zapier、Make、Gumloop、Lindy 天然碰不到你的电脑；自装的 Dify 和 Sim 把命令关在隔离环境里，Sim 的命令行代码只能在远程的一次性隔离环境里跑（[Dify releases](https://github.com/langgenius/dify/releases)、[Sim Function](https://docs.sim.ai/workflows/blocks/function)）。只有 Langflow 能原生装在 Windows 上（[Langflow README](https://github.com/langflow-ai/langflow)），但"在它的一站里调用本机的 `claude -p`"是笔记的推断，没有官方示例，也没验证。

**命令行代理这一圈：最接近的是 Claude Code 自带的动态工作流，但它缺图、缺等人。** 命令行代理指在终端里运行、能自己读写文件和跑命令的大模型工具，Claude Code、Codex CLI 都是。Claude Code 的动态工作流（dynamic workflows）是这样一种东西：你描述任务，Claude 写一小段程序，由后台调度一批子代理（主对话派出去干一件小事的独立 Claude）去干，这段程序可以存成一条命令、带新输入反复跑（[workflows 文档](https://code.claude.com/docs/en/workflows.md)）。它天然满足"只给两头、反复投料、自用、本机文件顺手、不用常驻服务"，但官方文档明写了几条硬限制：**运行中不能停下来等人签字**，要签字就把每一段拆成单独的工作流；干活的只能是 Claude，别家工具要经 MCP 接进来；整篇文档里没有流程图视图，只有按阶段分组的进度树（[workflows 文档：限制](https://code.claude.com/docs/en/workflows.md#behavior-and-limits)、[agents 文档](https://code.claude.com/docs/en/agents.md)）。社区项目里最对路的四个各缺一块。Archon 有门、有"循环到检查命令通过"、有人工审批，也能驱动 Claude Code 和 Codex，但线要人手写，状态在数据库（[Archon README](https://raw.githubusercontent.com/coleam00/Archon/main/README.md)）。microsoft/conductor 有可缩放的实时流程图和门，但线同样要人写，Claude Code 只是实验性接入（[conductor README](https://raw.githubusercontent.com/microsoft/conductor/main/README.md)）。CC Workflow Studio 有能拖拽、能让 AI 改的画布，README 里却没提门、状态和运行监控（[cc-wf-studio README](https://raw.githubusercontent.com/breaking-brake/cc-wf-studio/main/README.md)）。babysitter 的门是强制的、状态和日志是文件、能续跑，但没有流程形状图，流程要写成程序代码（[babysitter README](https://raw.githubusercontent.com/a5c-ai/babysitter/main/README.md)）。星数最高的 Spec Kit、ruflo、BMAD 是给软件开发用的固定方法，不替你设计任意产线。

**文件式流水线与编排引擎：两类"绕一绕能用"的恰好互补，没有一个两头都占。** Snakemake、DVC 这类工具把"产出文件在不在"直接当状态，定义是文本文件，还自带"干跑"命令（不真干活，只打印将会做什么，用来自检），和设计标准最合拍（[Snakemake 命令行](https://snakemake.readthedocs.io/en/stable/executing/cli.html)）。但它们明文要求流程不能有回头路：Snakemake 的原话是任务图必须无环，DVC 同样（[Snakemake FAQ](https://snakemake.readthedocs.io/en/stable/project_info/faq.html)、[DVC 定义流水线](https://doc.dvc.org/user-guide/pipelines/defining-pipelines)）。所以"不合格退回上游"画不出来，也没有等人判的门。LangGraph 正相反：判断结果可以指回任意一站，有总步数上限，能无限期停下等人（[graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)、[interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)）；但它的运行状态存在自己的检查点库里（检查点是引擎记下的"跑到哪了"，本地落盘只有数据库文件这一种），流程定义是 Python 程序，好看的界面托管在厂商网站上还要注册拿密钥（[persistence](https://docs.langchain.com/oss/python/langgraph/persistence)、[LangSmith local server](https://docs.langchain.com/langsmith/local-server)）。功能上最像"门、重做、等人"的 Kestra，恰恰是你想躲开的那种东西：要装 Java 的常驻服务，状态在数据库，官方说本地模式只适合测试（[Kestra Windows 安装](https://kestra.io/docs/installation/windows)）。Nextflow 和 Airflow 不支持原生 Windows，Argo 必须有服务器集群，Windmill 必须有 Postgres 数据库，可以直接排除（[Nextflow](https://docs.seqera.io/nextflow/install)、[Airflow](https://airflow.apache.org/docs/apache-airflow/stable/installation/prerequisites.html)、[Argo](https://argo-workflows.readthedocs.io/en/latest/quick-start/)、[Windmill](https://www.windmill.dev/docs/advanced/self_host)）。

## 缺的是同一块骨架：文件当半成品、每站一道门、退回指名的上游站

八条需求里，看得见、能反复跑、自用、能手改这四条几乎人人满足；卡住所有工具的是需求 5 和设计标准。把设计标准拆成三项，对照最接近的十个候选：

| 候选 | 半成品和状态是文件 | 每站一道门 | 不合格退回指名的上游站 | 来源 |
|---|---|---|---|---|
| n8n | ✘ 运行记录在数据库 | ◐ 能用判断、审批等节点拼出来，没有"门"这个概念 | ◐ 画得出来，轮数上限自己加 | [循环文档](https://docs.n8n.io/build/flow-logic/loop.md)、[执行相关环境变量](https://docs.n8n.io/hosting/configuration/environment-variables/executions.md) |
| Langflow | ✘ 流程定义可导出成文件，运行状态不是 | ✘/？ 没见到 | ✘/？ 没见到 | [lfx-mcp](https://docs.langflow.org/lfx-mcp) |
| Sim | ✘ 数据库 | ◐ 有打分、护栏、人工审批几种方块，各管各的 | ？ 循环是"把几个方块框起来重复"，文档没说能否连回上游 | [Loop](https://docs.sim.ai/workflows/blocks/loop)、[Human in the loop](https://docs.sim.ai/workflows/blocks/human-in-the-loop) |
| Flowise（已停更） | ✘ | ◐ | ✔ 有"退回到某节点、最多几次"的现成节点 | [AgentFlow V2](https://docs.flowiseai.com/using-flowise/agentflowv2) |
| Claude Code 动态工作流 | ◐ 默认在程序变量和会话目录里，靠约定才落成文件 | ◐ 能"循环到检查通过"，但不能等人 | ◐ 写在程序的循环里 | [workflows 文档](https://code.claude.com/docs/en/workflows.md) |
| Archon | ✘ 默认数据库 | ✔ 检查命令判定，加人工审批 | ◐ 循环到通过，带最多轮数 | [README](https://raw.githubusercontent.com/coleam00/Archon/main/README.md) |
| babysitter | ✔偏◐ 是文件，但默认放在用户目录而不是项目里 | ✔ 门是强制的，另有人工断点 | ◐ 不达标就重做 | [README](https://raw.githubusercontent.com/a5c-ai/babysitter/main/README.md) |
| Snakemake、DVC | ✔ 产出文件就是状态，但只有"有没有、新不新" | ◐ 只有机器判，没有人判 | ✘ 流程不许回头 | [Snakemake Rules](https://snakemake.readthedocs.io/en/stable/snakefiles/rules.html) |
| LangGraph | ✘ 检查点库 | ◐ 能停下等人，门要自己写成一站 | ✔ 可指回任意一站，带总步数上限 | [graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) |
| Kestra | ✘ 数据库 | ◐ 有暂停等人 | ◐ 只能重复自己那一块，跳不回前面 | [flowable tasks](https://kestra.io/docs/workflow-components/tasks/flowable-tasks) |

没有一行三格全是 ✔。设计标准的第四项"写明这条线什么时候拆"更干脆：调研读到的所有工具文档里都没有这个概念。还有一样东西也没人给：一张既显示流程形状、又显示"每件活现在停在哪一站"的图。引擎类工具显示一次运行走到哪，看板类工具显示每张任务卡在哪一道，两者没有合在一条可自定义的线上；最接近这个形态的是 Backlog.md，它把每件事存成一个文本文件，需要时才起一个本地网页看板，不要服务也不要账号（[Backlog.md README](https://cdn.jsdelivr.net/gh/MrLesk/Backlog.md@main/README.md)）。

这个缺口不是哪家"还没做"，而是骨架不同。这些平台把流程理解成"一串往下走的步骤，加上存在数据库里的运行记录"，站与站之间传的是内存里的数据；你要的是一条有质检、会退货、半成品摆在货架上的产线。所以每个"差一点"的候选，补到达标都得绕开它自己的核心。下面四个判断都是笔记里的工程判断，不是实测结果。用 n8n，就得让每个节点自己"读文件、干活、写文件、写状态"，n8n 只剩画布和调度的作用，而它的画布和运行时是捆在一起的。用 Langflow，补完门、退回、文件化半成品和自验证之后，它只剩"画图和手改"一个用处。用 LangGraph，要写的衔接程序和自己写一个小发动机差不多，还多背一份与"文件即状态"重复的检查点。用 Snakemake 这类，要在外面再包一层程序负责"门没过、删产物、记次数、重跑、超限转人工"，那一层其实就是自己写的发动机。

## 结论：底座用 Claude Code，发动机自己写，图自动生成

三个选项逐个过。**"直接用某个现成工具"排除**，上面两张表里没有一个够格。**"自己从头做"不必要**，因为最贵的几样都现成：对话框、会设计流程的 AI、能碰本机的工人、显示图的地方。**选"在现成底座上加一薄层"**。要说明的是，这个薄层里的发动机（那个小运行程序）不来自任何现成工具，是自己写的，所以严格说这个结论落在第二项和第三项之间，更靠第二项。

底座选 Claude Code 而不是 n8n、Langflow 或 LangGraph，依据都是读到的官方文档。Claude Code 有无头模式（不开聊天界面、一条命令进、结果出的用法）：`claude -p "<提示>"`，还能用 `--json-schema` 强制它按固定格式回话（[headless 文档](https://code.claude.com/docs/en/headless.md)）。别家也都有同类用法：Codex CLI 是 `codex exec`，Gemini CLI 是 `gemini -p`，Cursor 是 `agent -p`，Goose 是 `goose run`（[Codex](https://learn.chatgpt.com/docs/non-interactive-mode)、[Gemini](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md)、[Cursor](https://cursor.com/docs/cli/headless)、[Goose](https://raw.githubusercontent.com/aaif-goose/goose/main/documentation/docs/guides/goose-cli-commands.md)）。所以"换成别家"只是换一条命令模板，需求 1 的后半句不用另找平台。显示图也有现成的地方：Claude Code 桌面版的浏览器面板能点开本地网页，对话旁的面板能画图（[Desktop 文档](https://code.claude.com/docs/en/desktop.md)、[mods 参考](https://code.claude.com/docs/en/plugins/mods/reference.md)）。画图的写法用 Mermaid，它用几行文字描述流程、自动画成图，允许画回头箭头，能按状态给方块上色，AI 很容易写（[Mermaid 流程图](https://mermaid.js.org/syntax/flowchart.html)）。

薄层要做的事，笔记给了清单。产线定义文件是唯一的真相，写明站的顺序，每站的说明、输入和产出放在哪，每道门的格式要求、机器判还是人判、合格标准，不合格退回哪一站、最多退几次，以及这条线什么时候拆。每件活有自己的目录和一份状态文件，记着现在在哪站、退回过几次、是否在等人。小运行程序逐站调用命令行工具；机器判的门由它直接跑检查命令、看产出文件；人判的门把状态写成"等人判"就停手，等你表态后下次再继续。验收只看文件，不看命令的返回码，因为多数工具的返回码规则没写进文档。交付之前有两道自检：不真跑就能查的结构检查（每站有没有门、退回目标存不存在、退回有没有上限），以及拿样例原料真跑一遍并留下验证记录，记录齐全才把图给你看。图从定义文件和状态文件生成，改图就是改定义文件。

关于运行期由谁判门、记状态，两份笔记侧重不同，本报告取"外部小运行程序"。理由是官方文档写明的三条限制正好撞上设计标准：动态工作流运行中不能等人，工人只能是 Claude，中断后续跑绑在同一场对话上（[workflows 文档：限制](https://code.claude.com/docs/en/workflows.md#behavior-and-limits)）。设计和试跑阶段要不要借动态工作流来加快，留到原型之后再定。可以不做的东西很多：常驻进程、数据库、网页服务、定时调度、复杂并行，以及第一版的拖拽编辑器。

这个结论与项目文档里那份你还没点头的提议（定义文件、执行器、图页面，对话框先用 Claude Code）方向一致，调研为它补了四处：机器门要由运行程序直接判，不要隔着一层模型转述；人判的门必须单独成一站，状态写进文件；交付前要有"结构自检加样例真跑"两步；定义文件的用词尽量沿用 DVC、Task、Snakemake 这些工具已经验证过的叫法，将来万一要换成现成引擎，定义和半成品文件都不用动。

**最大的不确定点：薄层到底薄不薄，没有任何原型佐证。** 笔记估计小运行程序加自检加出图合计约 500 到 900 行，并明说这个数字没有原型支撑，误差主要来自 Windows 上给子进程设超时和清理、命令里的引号和路径处理。调研全程只读公开网页，没有安装或运行任何工具。同样没有数据的还有"AI 只拿到两头时，设计出的线一次跑通的比例"：官方只有"会出错、需人工复核"这类免责的话，一份第三方基准测试的结论是任务一复杂，模型生成的流程就不稳（[arXiv 2604.19667](https://arxiv.org/html/2604.19667v2)）。后一条是整个项目要验证的假设，三个选项都绕不开它，所以它决定的是"值不值得做"，不改变"选哪个"。

**做决定前动手验证两件事。** 第一件，做一条两三站的小样线：手写一份定义文件，至少含一道机器判的门、一道人判的门、一条退回路；让一个最小的运行程序在这台电脑上逐站调用 `claude -p`，半成品和状态都落成文件；再把其中一站换成 `codex exec` 试一次。看三样：能不能稳定跑完，程序实际写了多少行，Windows 上的引号、中文路径、超时和撞到订阅额度时有没有坑。第二件，把自动生成的图放到你实际会看的地方，你提两条意见让 AI 改，再自己手改一处定义文件。如果"提意见或改文本，图自动重画"你觉得够用，薄层成立。如果你一定要用鼠标拖着改图，就得多做一个画布编辑器，或者借 CC Workflow Studio、Langflow 的画布，那是最贵的一块，结论要重新掂量；借 Langflow 之前还得先验证它的一站能不能在 Windows 上调起本机命令，这一点目前只是推断。

## 十处说法对不上，多数以读到官方原文的那份为准

| 对不上的地方 | 一边怎么说 | 另一边怎么说 | 本报告的处理 |
|---|---|---|---|
| n8n 对话助手在免费自装版里能不能用 | n8n 笔记：官方文档写明免费社区版可用，用自己的大模型账号；"要 2.36 以上版本"只读到搜索摘要 | 对话式平台笔记：读了官方博客原文，自装版必须是 Docker 部署、2.36 以上、自带模型密钥，旧的 npm 安装方式不支持，功能还在预览开关后面 | 两份都确认**能用**，不矛盾；附加条件以读到博客原文的后者为准。后果是"装在 Windows 上最顺的 2.x 旧安装方式"恰好用不了这个助手。未查实：2026 年 11 月预览开关是否还在；两份笔记引的文档网址不同，哪个是现行页没核对 |
| n8n 助手"自己验证"到什么程度 | 官方博客：搭、跑、诊断、修、重跑，自动循环 | 官方文档：措辞保守，只说能运行检查、看错误、建议修法，并提醒会出错 | 按"部分满足"算；两份笔记都没有实测 |
| n8n 官方 MCP 的状态 | n8n 笔记：读了官方文档，云版和自装版都能开，创建和编辑流程从 2.13.0 起可用 | 对话式平台笔记：只有第三方文章，称 2026 年 4 月推出、公开预览 | 以 n8n 笔记为准。未查实：是否仍算预览；免费版里有没有功能删减 |
| n8n 能不能跑本机命令 | 对话式平台笔记：本轮没核实，打了"？" | n8n 笔记：读了官方文档和源码 | 以 n8n 笔记为准 |
| n8n 里画不画得出"退回" | 官方文档：能，连回前面的节点再加判断 | 论坛：有人说不支持真正的回头连线，有人说可用 | 以官方文档为准；没有实测 |
| 哪个现成工具"最接近" | 对话式平台笔记：Sim 或 Langflow；命令行笔记：Claude Code 动态工作流 | 文件式笔记：没有一个算"好"，建议自己写小发动机 | 不算矛盾，三份笔记各只看自己那一类，也都写明了范围；本报告综合后取"Claude Code 当底座，发动机自己写" |
| 薄层里谁来判门、记状态 | 命令行笔记：两条路（全放进动态工作流，或外部小运行程序），建议探索期用前者、投产后用后者 | 文件式笔记：直接写一个单进程小发动机 | 运行期取外部小运行程序；探索期是否借动态工作流待原型后定。两边都是推断，没有原型 |
| Claude Code 动态工作流是否已正式发布 | 官方博客和文档：已正式发布 | 第三方文章：还是研究预览 | 以官方为准 |
| Sim 自装版的对话助手是否在本机跑 | 官方 README：Chat 是 Sim 托管的服务 | 第三方：请求转发到 sim.ai，需要它发的密钥 | 可以确定不是纯本机；转发细节未查实 |
| Archon 能否让 AI 按描述生成流程 | README 和官网首页没提 | 调研者"印象里有" | 未核实，本报告按"未见"处理 |

来源依次见：[n8n Assistant 文档](https://docs.n8n.io/build/ways-of-building-workflows/ai-assistant.md)与[官方博客](https://blog.n8n.io/introducing-n8n-assistant)；[连接 n8n MCP 服务文档](https://docs.n8n.io/connect/connect-to-n8n-mcp-server.md)与[第三方文章](https://dev.to/abhijeet_singh_4577af3ef9/n8n-mcp-server-turn-workflows-into-ai-agent-tools-2026-55eg)；[循环文档](https://docs.n8n.io/build/flow-logic/loop.md)与[论坛帖](https://community.n8n.io/t/circular-workflows-question/282493)；[Anthropic 博客](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)与[第三方摘要](https://agentic-ai.readthedocs.io/en/latest/WorkflowBuilders/dynamic-workflows/)；[Sim README](https://github.com/simstudioai/sim)与[PR #4420](https://github.com/simstudioai/sim/pull/4420)。

另有几处小出入不影响结论，也都没查实：Zapier 的人工审批在哪些套餐可用（官方帮助中心和官方博客说法不同）、Gumloop 还有没有免费档、Lindy 现在还有没有流程编辑器、Codex CLI 的 Windows 支持是否仍算实验性。还要提醒一点：笔记里的引文都是抓取工具把网页转成文字后摘出来的，个别措辞可能与原页有出入；真要据此拍板，值得人工打开原页核对三条——Snakemake 和 DVC 禁止回头路、LangGraph 恢复时整站重跑、Kestra 本地模式只适合测试。

## Conclusion

行业的方向和你的想法是同向的。厂商自己也承认"大脑"应该是命令行里的编码代理：Flowise 因此停更，Dify、Langflow、Sim、Activepieces 四家转而给编码代理开了门。画布正在从"搭流程的手段"退成"给人看、给人改的界面"。所以你和现成工具的真正差别不在画布，而在"门、退回、文件"这套骨架，这恰好是买不到的那一块，也是该把力气花上去的那一块。画布反而应该做得越薄越好：Claude Code 按周更新，官方哪天自己加出流程图视图并非不可能，调研只能说在已读的文档、博客和近几版更新记录里没看到信号。只要核心资产是定义文件和状态文件，换一种显示方式不伤筋骨。

调研回答不了、但比选型更靠前的一件事，是你铁律里的"先成熟再上线"：第一条拿来试的线，应当是你手工做成过至少两次、成品被你认可过的线，否则验证出来的只是工具，不是产线。这个工具自己也该写明什么时候拆：官方补上了流程图和门，或者需求长成多人协作、定时触发、上百件并发，那时 Kestra、Temporal 这类重引擎才开始划算（这一句是笔记的工程判断）。在那之前，一份定义文件、一个小运行程序、一张自动生成的图，是离八条需求最近的路。
