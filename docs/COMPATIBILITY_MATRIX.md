# 生态兼容能力矩阵

本页只记录固定参考环境下的不支持、部分支持、有意差异及不可从公开能力清单推断的边界；不代表当前上游的全部能力。已支持成员不在文档重复列举。

## 1. 口径与参考身份

固定组件、精确提交与只读复现见 [ST 参考](SILLYTAVERN_REFERENCE.md)和 [Risu 参考](RISU_REFERENCE.md)。oracle 不随上游自动更新；能力名称存在不等于相关产品状态、卡外配置或服务已接入，没有真实来源的事件和状态不得伪造。

完整名称、参数与行为断言由以下可执行资料负责：

| 能力 | 权威清单与验证入口 |
| --- | --- |
| 酒馆助手宿主写入、实体、变量与事件 | [host_write_contract_oracle.json](../tools/fixtures/host_write_contract_oracle.json)、`tools/tests/host_write_contract_browser.js`、`card_frontend_same_origin_runtime.js` |
| 生成与事件 | [generation_contract_oracle.json](../tools/fixtures/generation_contract_oracle.json)、`tools/tests/generation_contract.js`、`generation_contract_browser.js` |
| Prompt Manager | [ST 固定参考](SILLYTAVERN_REFERENCE.md#语义复现入口)、`tools/tests/prompt_settings_coverage.js`、`round_preview_send_parity_browser.js` |
| STScript、音频 | `tools/tests/stscript_prompts.js`、`stscript_ui_browser.js`、[audio_host_oracle.json](../tools/fixtures/audio_host_oracle.json)、`audio_host_browser.js` |
| 提示词模板 | [prompt_template_oracle.json](../tools/fixtures/prompt_template_oracle.json)、`tools/tests/prompt_template_contract_browser.js`、`prompt_template_pipeline_browser.js` |
| ST 宏、Risu CBS/Trigger/Lua | 各实现的 capabilities/声明清单与 [Risu 复测入口](RISU_REFERENCE.md#取证与复测入口)；不能把识别数量当作全量可用证明 |

JS-Slash-Runner 名称以固定 `src/function/index.ts` 的真实导出为准，排除内部接线 `_th_impl`、`_bind`；事件另按类型定义核对。类型中声明的 `placeholder_prompt_default_order` 在运行时仅以 `builtin_prompt_default_order` 导出，不按文档补造另一名称。

## 2. SillyTavern 1.19.0 角色卡与生成编排能力面

### 2.1 角色卡、消息和扩展运行边界

| 例外 | 边界与理由 |
| --- | --- |
| 卡片与聊天文件库 | 只提供本地卡片导入和消息主模型，不复刻 ST 服务端目录或文件管理 UI；未知扩展保留但只执行已声明消费者。格式、容器拒绝项及未知字段规则以[导入约定](DATA_MODEL.md#8-导入与未知字段)为准。 |
| Markdown 与 showdown 的差异 | `#` 后须有空格；文字下的 `---` 只作分隔线，不作 setext 标题；行首 `- `/`* ` 须带空格。不支持四空格缩进代码、引用/列表懒续行、引用式链接、`<url>` 自动链接、emoji 短码和下划线强调。表格遇空行或无竖线行结束，分隔列至少两个 `-`，单元格 HTML 不解析；空行保持换行、不合并段落。只有 HTTP(S) 链接生成 `<a>`；与卡片 HTML 行内元素同行的文字不成块。HTML、卡片前端及围栏先保护，输出仍净化。 |
| MVU 执行所有者 | 有 bundle 就由卡片 bundle 接管；没有 bundle 的单一 Zod Schema 才本地回放。bundle＋Zod 的原脚本仍执行，但本地引擎退出，共用既有候选而不双写或迁移。 |
| ERA 未闭合控制块 | 只在助手显示正则前隐藏未闭合 `VariableThink/Insert/Edit/Delete`、`era_data` 段，保留后续控制段和状态占位边界。完整块仍交原卡有序正则；区分正文代码示例和控制块围栏。不补 JSON、不改原文或发送/编辑正则，自动结束不代表块完整。验证：`tools/tests/era_control_display.js`。 |
| 远程网页与裸 iframe | 完整 HTML/head/body 前端和启用脚本产生的元素保留浏览器网络行为；裸 iframe 文本不提升为卡片前端。卡片自己的远程字体也保留浏览器行为。宿主本地图标版本与加载约定见[发行依赖](FRONTEND_MODULES.md#本地发行依赖)。 |
| 普通态与全屏布局 | 普通态宽度取气泡内容盒/沉浸消息网格，高度由内容撑开，聊天页负责纵向滚动；排版参考高度取聊天可用高度扣操作栏与边框，TH 高度变量同时写子文档和 iframe。卡片 Fullscreen API 统一映射宿主画布，嵌套调用不再建一层；Android 使用独立运行态，不依赖延迟 Promise 或 CSS 全屏伪类。电脑版为 1080px 逻辑视口，实际内容独立滚动，1–4 倍用户缩放不改变内容范围。 |
| 卡片横向溢出与父页几何 | 只有被 `hidden` 祖先截断且祖先确有横向余量的可见交互元素才取得内部横向滚动所有者，不按卡名/DOM 名特判，装饰溢出不触发。可信交互维持宿主物理阅读锚点；补偿限同轮并让位新手势，不反复固定旧位置。父页任意新增/改写的 style 仅在引用当前 frame 且改变普通态宿主几何时停用；可信交互期的祖先 inline 几何恢复交互前值。不改变 CSSOM 或同源访问合同。 |

### 2.2 生成、Prompt Manager 与提示词转换

预设 raw、启停、覆盖、导出和保存边界统一见[聊天补全预设](DATA_MODEL.md#214-聊天补全预设)。以下是相对固定 ST 的例外：

| 例外 | 当前语义 |
| --- | --- |
| 无产品入口的生成类型 | 不伪造对应入口或事件。官方 dry-run 零出站的 ARGO marker 原样保留并在 UI 明示；其他未知 marker 保留但不出站。 |
| 角色卡覆盖的原文 | `/sysprompt` 选中的命名系统提示词档也属于 `{{original}}` 可替换的原文；其余覆盖和 `forbid_overrides` 规则见数据模型。 |
| 续写末条角色 | `continueNudge` 在夜欲装配层直接为末条 user；ST 装配为 system，再由 Google/Claude 转换层改 user。此差异避免 Gemini 兼容层在 model turn 结尾报 400。 |
| 预设参数与预填 | 参数保真，不覆盖设置；`stream_openai` 不控制主对话流式，只有全局开关生效。`assistant_prefill` 对 OpenAI 兼容/自定义协议也作为尾部 assistant（ST 只对 Claude），Gemini 和开启思考的 Anthropic 不发送。退役 `wrap_in_quotes` 只保真。 |
| 工具消息转换 | 不增加 `MERGE_TOOLS/SEMI_TOOLS/STRICT_TOOLS` 第二套 ST 转换；当前无真实卡片消费者。工具注册、预设工具调用开关和 OpenAI-compatible `tools/tool_choice` 请求均不支持；raw 的 `function_calling` 保真，旧工具消息按普通历史显示。 |

### 2.3 宏、世界书、Regex、STScript 与 Quick Reply

| 例外 | 当前语义与坑 |
| --- | --- |
| 无宿主宏与未知宏 | `55-prompt-core.js` 的 `CHARACTER_OFFICIAL_SUPPORTED_MACROS` / `CHARACTER_OFFICIAL_UNAVAILABLE_MACROS` 是唯一名称清单；无禁用词注册表、text-completion instruct 状态，相关宏明确拒绝。未知宏保留字面量。 |
| ST 宏差异 | 行内注释和 `{{//}}…{{///}}` 作用域体内的宏均不执行，闭合可多斜杠；固定 1.19 新引擎会先求作用域体内 setvar 等副作用，夜欲有意让注释整体不求值——作者注释掉 setvar 就是要停用它。卡片 `generate` 中的 `{{lastGenerationType}}` 返回 `card-frontend`，上游 TH 不发 `GENERATION_STARTED`，故 ST 保持上次类型。别把宏返回值再次扫描：嵌套参数先展开、if 分支延迟，未知外层内部的嵌套宏仍求值；额外 `{`、最终反转义和 UTC 小于 16 按小时的语义以固定 ST 参考为准。 |
| 表情宏宿主 | lastExpression 读取目标单角色会话最近选择，defaultExpression 读取本角色素材组默认项，availableExpressions 列出本组可用素材标签；无 Extras/classifier 全局标签表，不模拟其他角色或群聊状态。 |
| 世界书默认位置 | 外来 Risu/NovelAI/Agnai 转换书放角色设定前，夜欲新建条目默认放角色设定后。不复制 ST 外部文件库。字段、正则关键字判定与受限表达式规则见[世界书映射](DATA_MODEL.md#215-世界书条目字段映射)。 |
| Regex 深度 | ST 正则的统一深度排除隐藏、comment、imagine 图片消息，续写目标为 -1；EJS 模板正则保留其上游的 `chat.length - idx - 1`。不要把两者合并。世界书仅 promptOnly 改写；同时勾显示/发送的不改写，只有发送且无官方 only 标记的算 promptOnly；@D 缺深度按 4，其他位置不作深度过滤。 |
| STScript 缺少产品能力 | 群聊、文本补全、图片描述扩展等明确报错；逐名及参数差异按固定 ST 参考和对应 `66-stscript-*` 注册核对。`/listvar` 无 `return=` 时静默返回 `{key,value,scope}` 列表、不弹窗，`scope=` 过滤列表。未赋值 `{{var::}}` 与 ST 一样中断整批并报告条目、行列。 |
| ST 表情 | 单角色图片宿主，不提供 Extras/local/WebLLM 分类或 Emoji 立绘；Risu 退出该宿主。自动分类须主动启用，仅把当前正文与原始标签发给当前聊天模型；停止/切换/新请求作废旧结果，失败保留当前图。命令参数、匹配和目录差异以 `expression-*` 注册为准；持久化见[立绘与表情](DATA_MODEL.md#213-角色立绘与表情)。 |
| 附件资料库 | 本地附件所有者，不部署 ST 服务端解析插件；Office 须先转 PDF/文本。查询消息默认 6、范围 4–8（ST 默认 2）。PDF fake worker 未配 CMap 可能缺 CJK。保留参考坑：注入按数组顺序、db-update 重置 disabled、fresh 不检测新增、purge 未串行。容器拒绝、附件引用回收与数据归属见[数据模型](DATA_MODEL.md#212-附件资料库)。 |
| 扩展存在宏、主题与图库 | `hasextension` 只对酒馆助手/提示词模板及其目录别名为真，不开放扩展安装。主题/图片库使用夜欲本地对象，不伪造 ST 内容来源。 |
| Quick Reply context 与管理 | `contextList` 不属持久模型，`qr-contextadd/del/clear` 不可用；不另建 ST 的额外 scope、编辑管理、插件命令。按上游 disableSend 规则，只有 `/` 开头且允许发送的 QR 当脚本执行，其余填输入框，允许发送则发出。 |
| Quick Reply 发送与报错 | 夜欲等待嵌套发送完成，期间不自动执行；生成前、用户消息后和世界书触发阶段拒绝嵌套发送并保留输入框文本（ST 不等待）。自动执行运行错误显示提示（ST 仅 console），各条隔离错误但 AbortError 上抛；`/run` 解析错只提示，运行错抛调用方。 |

`/imagine`（及 `/sd`、`/img`、`/image`）使用「设置 → 生图」来源，一条命令一张，具体行为由 `tools/tests/stscript_imagine_browser.js` 固定。与 ST 的差异及不生效参数必须保留：

- 自由文本按卡片提示词处理：直接总结来源原样发送，去敏感化来源先改写；去掉 ST `char` 前缀和 `{{charPrefix}}` 空前缀。不作 LLM 自由扩写或多模态描述；来源/风格/Comfy 工作流命令不可用，统一在设置管理。
- `scene` 与 `last` 取材相同（ST 的 scene 是剧情回顾加角色/环境）；`raw_last` 取最新非系统消息可读正文，不拼 SD 权重或角色设定。触发词取材走既有出图提示词路由；`edit` 只对触发词生效，取消返回空串。
- `model` 覆盖来源模型；width＋height 在 Grok/Gemini 取最接近画幅，在 OpenAI 兼容源作 size；缺省 face 竖幅/background 横幅。Gemini 为 Nano Banana `generateContent`（ST Google 源用 Imagen `:predict`）。
- `negative` 接受不发送，与 ST xAI 源一致；`gallery/extend/multimodal/snap/processing/seed/steps/cfg/skip/sampler/scheduler/vae/upscaler/hires/scale/denoise/2ndpass/faces` 接受但无效。
- 返回可重载的自包含 data URL，代价是体积；quiet 图不另存。非 quiet 建系统图片消息、不进 Prompt；消息生图沿原提示词追加，不再调用模型。background 把图加角色图库并锁当前对话（ST 使用聊天背景列表）。失败提示原因并返空串；停止中止提示词与出图请求，干跑只给调用占位。
- 不实现「send me a picture」自动出图或图片越界右滑再生成。尾部图片消息保留，重新生成/续写/右滑新候选仍作用前面的回复；ST 重新生成会删尾图，候选箭头也落在图片消息上。数据形状见[会话](DATA_MODEL.md#22-会话与转盘方案)。

卡片事件取消边界：消息命令的监听器只有明确属于本次命令时才沿外层事务嵌套；独立点击仍串行排队。跨 frame 再派发传播来源和停止信号；普通 await 共享发起监听器取消分支，同步派发兄弟分支独立且不等待 Promise。外层正常结束后异步监听器转顶层队列并重验停止；真正取消、失败或失效来源的 Slash、变量、消息及其他写入均拒绝，捕获错误或计时器不能恢复来源。不连带取消同帧其他监听器、独立点击或正常完成后脱离来源的独立计时器。无 STScript 来源的事件以所属实例退役阻止迟到回调。行为验证见 [卡片同源运行时测试](../tools/tests/card_frontend_same_origin_runtime.js)。

## 3. JS-Slash-Runner 4.11.3 公开能力例外

### 3.1 iframe 宿主与直绑全局

- 消息 frame 按可见性和同时运行上限挂载，离屏回收与重挂规则见[挂载调度](FRONTEND_MODULES.md#消息前端挂载调度)。常驻脚本共用角色 library frame，所以 `reloadIframe` 重载整组而非单脚本物理 frame；逻辑脚本名/id 仍按调用栈取得。全局脚本调用消息 id 明确抛错。
- `SillyTavern/Mvu` 只投影真实主模型；`registerMvuSchema`、`getRequestHeaders` 使用明确错误，其他未暴露名称没有对象键。主窗口脚本所需 facade 只临时投影，由所属 iframe 卸载恢复。无真实产品来源的事件不伪造。
- `waitGlobalInitialized('Mvu')` 必须同时等到父页真实 Mvu，以及第 0 楼或末 10 楼任一当前 swipe 的 stat_data；只读最多 11 个候选，不刷新上下文。默认一直等待，五秒只提示仍在等待；显式 timeout 才拒绝，取消/销毁按 AbortError 清理，不能计时假成功。
- 父页 DOM/jQuery 的输入与发送映射真实控件；失效 frame 的旧异步回调不能再取得输入控件，错误在主界面可见。标准两类 ResizeObserver loop 通知不算脚本失败，其余错误仍报告。

### 3.2 `TavernHelper` 顶层公开成员

| 例外 | 当前语义 |
| --- | --- |
| `builtin`、扩展安装/管理员管理 | 不透传 ST 内部函数、不建扩展服务器。`isAdmin/getExtensionType/getExtensionStatus/isInstalledExtension/installExtension/uninstallExtension/reinstallExtension/updateExtension` 等服务端入口不提供。 |
| 版本更新 | 固定回报 TavernHelper/Frontend 4.11.3、Tavern 1.19.0；在线更新明确拒绝，不假成功。 |
| `importRawChat` | 不支持。角色/raw 预设/世界书/Regex 走现有导入所有者；同名角色覆盖及本地状态保留清单见[脚本实体](DATA_MODEL.md#211-脚本实体注入与变量界面)。随卡书按 ownerCharId 配对，只替换旧卡条目并保留用户条目；新卡无 world 时仍用 boundCharIds 绑定（ST 按旧 world 整本覆盖）。 |
| 卡片写入全局 Regex | 用户选择：脚本写入的全局行归写入角色，读取/替换只涉及用户行与本角色行，仅对该角色生效，删角色时删除；ST 全局行对所有角色常驻。字段与替换规则见数据模型，不建立第二份全局表。 |
| `triggerSlash/triggerSlashWithResult` | 同一函数，跨 frame 沿既有 `_qrChain` 串行；不引入上游 per-frame mutex。宿主事务 owner/dirty/snapshot/nest 为单例，重叠会覆盖快照，因此串行是数据边界。 |
| `generateRaw.preset_name` | 4.11.3 公开类型与真实运行矛盾，明确拒绝；generate 的命名预设仍读唯一 raw。 |
| `custom_api` | 指定 URL 或 proxy preset 时传输仅 OpenAI-compatible，接受 openai/custom/deepseek/openrouter/xai；显式兼容 URL 独立于主聊天供应商，地址覆盖的凭据规则见[传输边界](ARCHITECTURE.md#35-请求路由)。proxy preset 对应启用供应商，命中由预设 URL/key 最终覆盖，model 仍显式或当前；指向原生协议或 Grok 订阅的预设明确拒绝。名称未命中回退显式 URL/key 或当前兼容路由，不能静默借用原生路线；两者都未指定时沿用当前路线（含原生），只覆盖 model、key 与采样参数。需要 ST Claude/Gemini 转换的 source 拒绝。 |
| `json_schema` 与未知配置 | 仅公开 `{name,description?,value,strict?}`，value 转 schema、默认 strict；Anthropic 使用原生 `output_config.format` 并与 effort 共存，schema 原样发送，不删约束或改走其他路线。结构错/已知不支持/4xx 直接报错，不删除 schema 重试；供应商拒绝或截断不作为完整结果返回。实际模型与 schema 特性限制由供应商判断，依据见[原生结构化输出文档](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)。tools/tool_choice 按未知配置报错；未知 raw 占位符和非法注入 position/role 也拒绝。 |
| 模型/proxy 枚举 | getProxyPresetNames 为启用供应商设置顺序；getModelList 复用 OpenAI-compatible GET /models，不伪装 ST proxy/status 网络拓扑。 |
| 生成并发与停止 | Prompt 暂态区（向量、Regex/世界书、续写）串行，网络可并行；id 注册/停止全局，不限发起 frame。should_silence 只控制绑定停止按钮，不限制显式停止。 |

生成事件有意差异（完整键值/负载由 generation oracle 负责）：

1. MESSAGE_SENT 在用户消息渲染后发，ST 在前。
2. 新候选 MESSAGE_SWIPED 发出时尚未写候选，ST 已有空候选。
3. GENERATION_ENDED 在回复 received/rendered 之后，ST 流式在前；停止顺序为 STOPPED → RECEIVED → RENDERED → ENDED，ST 为 ENDED → STOPPED → RECEIVED。
4. STOPPED 仅在停止进行中的主生成时发，ST 无条件；STREAM_TOKEN_RECEIVED 至少 100ms 合并，整段 JSON 回复不发。
5. 重新生成不发 MESSAGE_DELETED，因为保留原回复并在失败还原。
6. 切会话时旧、新脚本库各收一次 CHAT_CHANGED(新 id)。
7. 消息 frame 脚本运行后给自身楼层补 rendered，并按 frame/楼层/事件/seq/正文哈希去重；上游收不到自身楼层 rendered。

临时 helper 不伪造 tavern started/ended；预览按 ST dryRun 派发并消费参数改写、跳过 QR 生成前脚本。`GENERATE_AFTER_DATA` 的附加 chat 是 prompt 的读写别名，原地改动与整体替换一致。不要从 UI 停止按钮推导事件来源。

generate/generateRaw 在配置转换前发 GENERATION_REQUESTED，监听器可原地改写配置；should_return_reasoning 为真时返回仅含实际元数据的详情对象，否则保持字符串。工具调用仍按未知配置拒绝；4.11.3 的 reasoning token 事件及内部 js_generation_before_end 尚未接入，不把详情返回值等同于这些事件。

### 3.3 其余公开入口

`SillyTavern.getContext()` 不伪造 accountStorage、全局 tag/tokenizer 注册表、扩展模板/安装服务、翻译包、连接管理、ToolManager、DataBank 或 manifest；预设管理器仅 OpenAI-compatible。Mvu 有 bundle 时委托 parent.Mvu，parseMessage 始终返回克隆。音频的 STRING `play=false` 实际为真、`/audioenable` 空返回且不改状态，是 4.11.3 真实行为，不能当成待修复 bug。

## 4. ST-Prompt-Template 1.17.9 公开能力例外

### 4.1 运行阶段和语法

| 例外 | 规则与参考坑 |
| --- | --- |
| EJS 执行权限 | 与参考一样在宿主主页面执行，不按内容来源门控；角色脚本开关、导入模式不约束模板。预览真实执行原有联网；宿主模型/STScript 占位及主数据写入隔离不代表 JavaScript 沙箱，详见下节。 |
| render_permanent/raw | 一律为当前 swipe 的可失效显示快照，原消息保持原文；完成前或失败后不显示 EJS 源码。 |
| `[GENERATE:REGEX:pattern]` | 固定参考只有文档，无 src/dist 实现，不发明语义。 |
| `@INJECT` | 上游 `.filter()` 漏 return，候选恒零且默认关闭；夜欲同样为空操作，过滤特殊条目而不泄漏到普通世界书。它与有效的 context injectPrompt 注册表不同。 |
| 预处理与标题 | 正文/主次关键字按各自字段求值，不复刻上游误用正文求值关键字的缺陷。特殊条目沿参考默认反转启用（ST 中关闭才执行），启用的特殊项也不普通注入。标题大小写不敏感，是有意超集；阶段标题按前缀，Preprocessing 按包含匹配。带参数但参考无法匹配的 decorator 不扩写同义语法。 |
| 私有运行面与开关 | 参考 cache/worker/sandbox/editor 关闭；夜欲不建第二套缓存、沙箱、Worker、编辑器或持久配置。setFeatures 要求缺失运行面时报错；关闭 enabled/generate/raw 会裸出 EJS，故拒绝，关闭 render 则隐藏源码。extensionSettings.EjsTemplate 只投影实时视图、写入委托 setFeatures，不持久化第二份。 |
| 装饰器 | 完整 16 名称见 oracle；dont_deactivate 不冒充第 17 项。普通非 preprocessing 的 private 采用 async-IIFE，夜欲已经分离 decorator，不能重新把 private 字面量拼到请求。普通 disabled 条件/预处理不执行，always_enabled 可启用。 |

#### 联网与同轮复用

预览允许原卡请求产生远端动作。模板 context 仅有局部联网门面，不改宿主全局函数；fetch/XHR/WebSocket/EventSource 裸调用和 window/globalThis/self 一致。sendBeacon、动态 import、模块顶层、Image 和 DOM 加载保留原生效果；不保证任意全局写入隔离。

成功预览的 fetch 序列仅在 pending round 内复用；有效设置/raw 预设、角色/会话、历史/变量、世界书、人格及模板定义相同，重复预览和紧随实发才能按调用序号与请求语义取 Response.clone。同 URL 多调用各占一项；首个差异或不可复用调用之后不再回放。换草稿/模板/请求/上下文失效，切 owner 清空，发送取走，下一轮不继承；只驻内存、不改变本轮随机规则。

可复用：字符串/URL 输入、无调用方显式 signal、空/字符串/URLSearchParams/字节数组体，以及完整读完且可克隆的普通响应。HTTP 非成功状态仍保留原生状态和内容。Request 只规范化一次，签名和发送用同一请求，不重读 getter；上传体签名并行读克隆，回放按序等待，后台读取不阻塞 fetch 或消费模板响应体。没读完或读取失败不能复用，同一 JS 任务立即实发可能真实再请求。

不复用：Request 对象、Blob/FormData/上传流、显式 signal、opaque、SSE/NDJSON/JSON-seq，以及不能可靠签名的函数/循环/特殊对象定义。XHR/socket/event stream/beacon/模块/图片/DOM 也不回放（浏览器缓存照常），所以预览/实发不能保证逐字相同。

可中断通道接所属事务取消，调用方 signal 仍有效；XHR/socket/event stream 门面保留子类/newTarget 原型及原生实例方法。取消/失败不提交序列，迟到体不能填后续运行；取消不能撤销已发生远端动作，模块/DOM 没有通用取消保证。宿主模型占位、接口写副本与生成互斥边界不变。

### 4.2 模板上下文公开函数与值

| 例外/易误判项 | 当前规则 |
| --- | --- |
| 变量 schema 与 YAML | setVariableSchema 仅本轮元数据；applyVarYamlAnnotate 输出当前变量 YAML，不建第二验证器或主数据。默认对象读取是 live 引用，clone:true 才隔离；持久写归统一 owner，initial/cache 临时。 |
| 聊天查询 | 保留复数 getChatMessages 的 start=0 返回空数组缺陷，单数没有；其返回正文而非 TavernHelper 消息对象。 |
| 动态 Regex | 保留 basic 首次 RegExp 丢 flags、maxDepth 取 minDepth、message after 无调用方。HTML 规则在 Markdown/系统转义后只执行一次，产物与参考一样不再 DOMPurify；原文不变、规则不落库、切会话清理。 |
| JSON patch | 保留数组删除空位、copy 共享内部引用、test 失败返回原文档、remove 失败提示、无效路径抛错、未知操作提示后继续；不能当作通用标准补丁库擅改。 |
| faker 就绪 | 本地懒加载，首次成功 context 等就绪；上游 ready 后延迟加载。失败同样保持 undefined，不阻断其余生成/渲染；版本与升级见[发行依赖](FRONTEND_MODULES.md#本地发行依赖)。 |
| Token/字符统计 | CHARS 为 UTF-16 长度，TOKENS 为 estTokens 估算，不保证同 ST tokenizer；LAST_RECEIVE 不含目标面板，仅回复提交后更新（参考任何非 dry-run 渲染后更新），编辑/刷新不同。不复制后台 timer 晚写。 |

### 4.3 `globalThis.EjsTemplate` 导出边界

公开成员集以 oracle 为准，frame 引用 host 单例。无参 saveVariables 等待所有公开/递归活动求值再提交，模板内部同名调用只绑定当前事务，不能自等待死锁；显式保存后的 prepared context 仍可再次写/存，按路径差量对账并发 canonical 写入。execute 和 STScript 共用宿主事务及重基，不建立第二套变量所有者。

## 5. Risu 卡片运行体系

Risu 的未接项、上游差异和复现证据只在 [RISU_REFERENCE.md](RISU_REFERENCE.md#未接项与上游差异)维护，不再重复已支持能力表。来源和数据保存以[数据模型](DATA_MODEL.md#8-导入与未知字段)为准：Risu 不混入 ST Regex/MVU/STScript/TavernHelper/EJS/预设自动任务；CHARX 内嵌模块不代表卡外模块管理器。

未知元数据保真不能证明可执行；真实卡流程也不能替代合成脚本语义测试或 Android/真实模型验证。ST `/tts`、`/speak`、`/narrate` 与 Risu `/speak`（含 V1/V2 触发器命令调用）使用夜欲当前角色声音；ST `voice=` 不另选角色。Risu 卡内 VITS 模型保真但不播放，可用夜欲云端朗读，不阻断其他内容；缺失图片的占位与裸资源宏省略遵循 Risu 显示链，不用 ST 宿主补执行。
