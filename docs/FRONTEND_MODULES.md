# 前端模块索引

本文维护经典脚本的职责和边界；实现细节以对应源码为准。实际加载顺序以 [index.html](../app/src/main/assets/index.html) 为准。行为和数据合同分别见 [ARCHITECTURE.md](ARCHITECTURE.md) 与 [DATA_MODEL.md](DATA_MODEL.md)，测试权威清单见 [test_manifest.json](../tools/tests/test_manifest.json)。

## 运行模型

加载、共享作用域和桥注册时机见 [架构的加载与启动](ARCHITECTURE.md#31-加载与启动) 及 [WebView 创建与恢复](ARCHITECTURE.md#4-webview-创建与恢复)。表中 `core/`、`workers/` 路径相对 `app/src/main/assets/js/`，其他脚本名相对 `app/src/main/assets/js/app/`。

## 当前脚本职责

| 脚本 | 职责与边界 |
| --- | --- |
| `core/pure.js` | 文本、Token、颜色、角色与 SSE 纯函数；无 DOM 或持久化。 |
| `core/charx.js` | 读取 CHARX 容器及内嵌图片；无 DOM 或持久化。 |
| `core/risu-module.js` | 解码 RPack/module.risum 并提取资产；不执行脚本。 |
| `core/risu-cbs.js` | CBS 条件与宏求值；变量写入由宿主回调承接。 |
| `core/risu-history.js` | 把脚本改写映射回动态宏模板并定位续写副作用；复用 jsdiff，不改原始消息。 |
| `core/risu-regex.js` | 执行 Risu 四阶段正则及 CBS 替换；不访问 DOM 或主数据。 |
| `core/risu-regex-runtime.js` | 托管可终止的 CBS、正则与世界书 Worker；快照隔离，不写主数据。 |
| `workers/risu-regex-worker.js` | 上述 Worker 的入口函数，由 risu-regex-runtime 序列化装入；无 DOM 或持久化。 |
| `core/risu-trigger.js` | 执行官方 V1/V2 触发器；副作用委托宿主，正则委托可终止 Worker。 |
| `core/risu-command.js` | 执行独立 Risu 命令管道；不调用 STScript，UI 与生成委托宿主。 |
| `core/risu-lorebook.js` | 解析 Risu 世界书条件、递归与注入位置；激活在 Worker 内执行。 |
| `core/risu-lua-worker.js` | 运行真实 CBS 与 Wasmoon Lua；无 DOM，只回传快照变更。 |
| `core/risu-lua.js` | 管理 Lua Worker/RPC 与取消；绑定角色、会话和脚本，无主线程回退。 |
| `core/wheel-scheme-engine.js` | 计算转盘公式、条件、数值与跳转；纯函数，无 DOM 或持久化。 |
| `core/repository-db.js` | 拥有数据库 schema 与事务，拆分组合主数据；无 DOM。 |
| `core/repository-media.js` | 分离、水合、引用汇总及清理媒体；拥有 media Store，无 DOM。 |
| `core/repository.js` | 提供主数据与流式草稿仓储门面；协调既有 Store。 |
| `core/vector-retrieval.js` | 请求嵌入并检索候选；仅通过仓储写派生向量缓存。 |
| `00-defaults.js` | 定义默认状态、常量与受保护 Prompt；无 DOM。 |
| `05-runtime.js` | 管理供应商路由、仓储适配、保存与恢复及设置表单；会话规范化留在内存。 |
| `06-provider-protocols.js` | 转换原生协议、思考参数及连通性测试；无 DOM 或持久化，输出统一响应形状。 |
| `07-grok-subscription.js` | 管理订阅授权、续期与白名单传输及登录块；账号只由 settings 所有。 |
| `10-ui-core.js` | 拥有净化、显示解析、通用展示 DOM 与资产 URL 生命周期；派生显示不覆盖原文。 |
| `12-motion.js` | 管理可打断的展示过渡；只持有动画及临时样式，不延迟业务状态。 |
| `14-modal.js` | 拥有页面导航、模态栈、焦点及编辑器关闭/保存守卫；不自行持久化。 |
| `15-controls.js` | 把原 select 呈现为应用内选项面板并派发输入事件；只拥有选择器 DOM。 |
| `16-list-reorder.js` | 管理长按拖动与临时位移；仅报告落点，由列表属主保存顺序。 |
| `20-prompt-memory-settings.js` | 拥有设置页草稿、提示词分组、模型检测与连通性测试；保存 settings。 |
| `21-layered-memory.js` | 整理、检索与编辑记忆；待确认批次只驻内存，确认后保存 session memory。 |
| `30-card-import.js` | 解析并预览单个角色卡，原子提交角色、会话和绑定世界书；拥有导入 DOM。 |
| `31-card-dependencies.js` | 纯分析卡片生态依赖与实际运行能力；无 DOM、网络或持久化。 |
| `32-risu-runtime.js` | 判定 Risu 来源并绑定 CBS 上下文与可见区间；显示求值不写主数据。 |
| `33-risu-execution.js` | 按会话串行管理 Risu 执行事务、显示及出图生命周期；原文保留，不调用 ST/MVU 链。 |
| `34-risu-lorebook.js` | 提供 Risu 世界书及事务视图并接入 Prompt；覆盖层与聊天本地条目分开，由 33 提交。 |
| `35-risu-display.js` | 拥有 Risu 消息、背景与情绪帧和按需资产；隔离样式与控件状态，不跨会话泄漏。 |
| `36-risu-options.js` | 拥有 Risu 选项与手动操作 UI；通过 Risu 事务保存，不写 ST 变量。 |
| `40-characters-persona.js` | 拥有角色列表、表单、背景与开场选择；保存角色、会话和绑定世界书。 |
| `42-persona-ui.js` | 拥有人格表单、列表、绑定及头像编辑；保存 personas 与活动人格。 |
| `43-wheel-library.js` | 拥有转盘方案导入、配色与管理；方案写 wheel_schemes，提示词设置写 meta。 |
| `44-wheel-game.js` | 拥有转盘对局、动画、音频与终局人物志；保存本机进度，生成草稿只驻内存。 |
| `45-expression-assets.js` | 解析并导入表情素材；复用角色扩展及既有媒体引用，无 DOM。 |
| `45-expressions.js` | 拥有立绘展示、管理与分类；配置及选择可保存，请求和 URL 只驻内存。 |
| `46-card-script-model.js` | 规范化 ST Regex/TavernHelper 声明与开关，协调运行资源释放；无 DOM。 |
| `47-script-worker.js` | 在可终止 Worker 执行 ST 正则；无 DOM 或持久化。 |
| `48-stscript-parser.js` | 解析执行 STScript 管道、闭包与取消，声明干跑分类；无 DOM 或持久化。 |
| `49-vector-retrieval-runtime.js` | 统筹本轮世界书与记忆检索；状态只驻内存及设置 DOM。 |
| `49-data-bank.js` | 拥有附件元数据、分块检索与提示词视图；正文及向量交给 repository。 |
| `49-data-bank-import.js` | 提取文本、HTML、PDF 与 EPUB；按需加载解析器，无管理 DOM。 |
| `50-worldbook.js` | 规范化绑定并执行世界书触发与注入位置解析；模板视图不改主世界书。 |
| `51-worldbook-ui.js` | 拥有世界书分类、条目及编辑 DOM；保存 worldBook。 |
| `52-worldbook-import.js` | 转换外来世界书并预览；确认后原子保存 worldBook。 |
| `52-mvu-body.js` | 在断网 Worker 校验 Schema 并回放 MVU 操作；仅供无 bundle 的单一 Zod Schema。 |
| `52-mvu-runtime.js` | 裁决 bundle 与本地回放的唯一所有者，维护消息候选状态；不改卡片源文本。 |
| `53-regex-scripts.js` | 拥有正则及顺序预设、执行副本与显示缓存；按归属保存 meta/characters。 |
| `54-message-panels.js` | 从消息派生目标、通告与剧情进度 DOM；保存回合归属，显示快照只驻内存。 |
| `55-prompt-core.js` | 构建系统/角色层并求值文本宏；提交构建才收口变量，只读构建用副本。 |
| `57-preset-manager.js` | 唯一拥有 ST raw 预设、出站顺序、管理器草稿与切换事务；主保存才持久化 settings。 |
| `57-preset-round-preview.js` | 拥有本轮预览与过期结果取消；只读完整草稿，经共享生成链构建。 |
| `58-prompt-pipeline.js` | 组装历史、世界书、角色、记忆与附加指令并按请求文本预算；helper 不写主数据，无 DOM。 |
| `60-prompt-build-cache.js` | 构建 Prompt 并更新 Token、世界书及记忆状态 DOM；不写主数据。 |
| `62-generation-state.js` | 维护交互生成身份、取消与聊天生成态 DOM；不拥有 helper generation id。 |
| `63-card-script-ui.js` | 展示脚本依赖、运行状态与统一开关；只保存角色脚本开关。 |
| `64-stream-drafts.js` | 管理流式 checkpoint、恢复与暂停 flush；通过草稿仓储写入。 |
| `66-stscript-commands.js` | 注册核心 STScript 宿主命令；副作用绑定启动角色/会话并委托既有所有者。 |
| `66-stscript-tools.js` | 注册数组、闭包、Token、剪贴板及重抽工具；变量交给 STScript。 |
| `66-stscript-ui.js` | 注册弹窗、遮罩、样式与背景命令；委托模态栈和主题所有者。 |
| `66-stscript-entities.js` | 注册角色、人格、聊天与消息命令；委托宿主实体及会话所有者。 |
| `66-stscript-worldbook.js` | 注册世界书、绑定、向量与正则命令；写入复用各领域所有者。 |
| `66-stscript-prompts.js` | 注册提示词、路由、思考模板及生成命令；设置修改遵循所在页草稿保存。 |
| `66-stscript-data-bank.js` | 拥有 Data Bank 命令与管理器；共用 49 的数据所有者。 |
| `67-quick-reply.js` | 拥有 Quick Reply 集合、绑定、自动事件与串行事务队列；按作用域保存 meta/sessions。 |
| `68-generation-commit.js` | 拥有视口任务与正式回复提交，串行安排提交后事件；只撤销未成功保存的本轮改动。 |
| `69-quick-reply-ui.js` | 拥有快捷栏、集合及条目管理 DOM；配置交给 67。 |
| `70-api.js` | 统一预填、请求后处理、聊天传输与结构化校验；单请求覆盖不改供应商设置。 |
| `72-stream-response.js` | 读取 JSON/SSE 并绘制流式消息与 checkpoint；提交时保留气泡和同身份前端。 |
| `73-card-frontend-body.js` | 提供帧内公开 API、事件总线与运行时；宿主写入、音频及 EJS 委托唯一所有者。 |
| `73-card-frontend.js` | 拥有消息/常驻脚本 iframe、挂载调度与 frame 生命周期；失效 owner 不再调用宿主。 |
| `74-host-write-contract.js` | 统一分派公开宿主写入与字段级撤销；重验 owner，只走既有仓储。 |
| `74-host-entities.js` | 分派角色、人格 CRUD 与历史读取；复用实体库和角色界面生命周期。 |
| `74-host-imports.js` | 分派角色、预设、世界书及正则导入；复用现有导入器。 |
| `74-host-prompts.js` | 注册与消费脚本注入；会话注入持久化，facade 与过滤函数只驻 frame 内存。 |
| `74-host-display.js` | 提供格式化、节点查询与异步显示刷新；不建第二消息存储。 |
| `74-host-variable-ui.js` | 拥有变量编辑控件；schema 只驻内存，写入走统一变量入口。 |
| `74-host-mvu.js` | 分派 MVU 解析、设置及初始化；调用实际 bundle 或既有 Zod Worker。 |
| `74-host-facade.js` | 映射 SillyTavern 上下文状态与操作；写入交给既有唯一所有者。 |
| `75-prompt-template.js` | 拥有 EJS 阶段、上下文、动态正则与同轮状态；持久写入委托 74，无第二套设置。 |
| `76-preset-task-runtime.js` | 执行活动 raw 内嵌任务并管理取消；任务定义仍由 raw 所有，运行状态只驻内存。 |
| `80-messages-generation.js` | 拥有同步正文入口、消息列表、渲染窗口与搜索；显示与搜索副本不写 content。 |
| `81-message-transactions.js` | 拥有消息编辑、翻译、候选操作及共享字段级撤销；按消息身份原子保存 session。 |
| `81-generation-prompt.js` | 共用预览、实发及辅助上下文组装；干跑不提交主数据，辅助任务状态独立。 |
| `82-generation-coordinator.js` | 协调交互/helper 生成、停止与提交；复用各阶段所有者，helper 不提交助手消息。 |
| `83-card-bgm-player.js` | 唯一拥有 bgm/ambient 音源、播放状态与面板；设置和列表分别保存 meta/sessions。 |
| `84-speech.js` | 拥有语音协议、当前显示文本提取、取消及内存音频缓存；不写角色卡或聊天。 |
| `84-speech-settings.js` | 全局声音嵌入设置标签页，与其他设置同事务保存；角色声音弹窗独立保存覆盖，二者草稿隔离。 |
| `85-structured-requests.js` | 封装记忆及支线结构化消费者；无直接持久化或 DOM。 |
| `86-image-generation.js` | 唯一拥有生图来源、传输、提示词、图片槽及取消提交；按消息候选身份原子保存。 |
| `90-session-chat-ui.js` | 拥有会话 CRUD、切换与开场初始化；集合失败仅撤销所属改动。 |
| `91-branch-return.js` | 拥有支线创建、回归预览/提交/撤销；核对幂等边界并原子保存 session。 |
| `92-theme-ui.js` | 拥有背景、取色、阅读语义色与系统栏外观；生成背景由 86 统一提交。 |
| `95-chat-io-mobile.js` | 拥有预设导出状态；调用受限原生保存或浏览器下载，不改聊天数据。 |
| `96-mobile-interactions.js` | 拥有移动导航、侧栏、输入高度与 IME 协作；生图委托 86，无持久化。 |
| `97-app-about.js` | 拥有版本显示、「关于」弹窗与正式版更新检查；只读公开发布元数据，提醒状态存 localStorage。 |
| `99-bootstrap.js` | 启动仓储、恢复界面与 shell 生命周期，协调视口和返回；无第二套数据初始化。 |

## 消息前端挂载调度

`73-card-frontend.js` 是唯一挂载调度器；常驻脚本库不参与可见性调度。消息 frame 离屏收回会丢失卡内临时状态，重挂按正文与变量重建，这是为避免真机重卡同时运行造成整体卡顿的产品取舍。

- 最新一条带卡消息的全部前端始终运行，其余受同时运行上限约束，优先照顾阅读位置和最近交互；全屏、交互、帧内生成及仍与视口相交的帧不收回，手动停止的帧不自动重启。
- 手势滚动期间不挂载或收回，停止后逐个启动；可见性变化不派发消息业务事件。
- 流式占位与正式提交尽量保持同一 owner/key；尚未闭合的前端尾巴不能运行，否则每个分片改变 key 会反复重建，流式显示等待占位，中断后显示折叠原文，原始数据不变。
- 等高占位复用同内容、同宽度的记忆高度；无 frame 时只能按聊天宽度匹配，不能拿已缩到提示文案宽度的占位匹配旧帧宽。
- 启动握手前切换角色/会话是正常取消，不留错误；运行中的失效脚本仍拒绝跨 owner 调用。

## 消息搜索

搜索覆盖整份当前会话及当前候选，不受渲染窗口限制；范围为用户、助手和普通 `/sys` 旁白，手动隐藏仍命中，脚本提示、批注、回归卡片及流式草稿不进入结果。

聊天、搜索和普通开场预览共用同步正文入口；搜索不执行显示正则，以只读 CBS 求值后的正文去素材宏、前端段、注释、MVU、代码块与标签，按不区分大小写的子串近似匹配，旁白保留转义显示的字面写法。搜索不运行异步显示模板，因此不承诺与所有卡片渲染逐字相同。

关键词与派生缓存只驻内存，按角色/会话隔离；宏环境或正文变化失效，停止、离开及后一次搜索取代前一次时，迟到结果不能更新新面板。输入法组合完成才搜索；软键盘引起的滚动不能误关闭正在输入的搜索面板。

## 聊天查看位置

`68-generation-commit.js` 唯一拥有视口任务，`80-messages-generation.js` 提供内容锚点与渲染窗口；各导航入口共用窗口，记忆压缩不得缩小阅读范围。

- 渲染窗口是性能预算；向上手势才触发自动加载，不能把初次布局导致的顶部提示相交当作阅读意图，生成跟随中不自动展开历史。
- 自由阅读与生成跟随分开：发送明确贴底；点击、焦点、键盘、重绘及媒体就绪不自行取得跟随权，手势立即使旧任务失效。
- 贴底是持续状态，不能用固定时限或一次媒体 settle 代替：附近 frame 在 settle 后才排队启动，显示转换也会迟到改高；生成结束时尚未完成的挂载仍须维持已有贴底，直到读者接管或会话/容器改变。
- iframe 内手势可能只表现为宿主 scroll，必须区分本应用写入、内容尺寸变化与读者滚动；所有补偿服从当前任务身份，不能反复恢复旧交互锚点。
- frame 改高按整块底边的实际位移补偿，不能固定正在变高那一行的顶边；浏览器自身 scroll anchoring 已吸收时不重复补偿，可见起点以下的块正常往下长。
- 角色/会话及分支分别恢复阅读位置；离开时处于最新一条应记为底部，而非具体行，否则晚到尺寸会把末尾顶走；原生后台返回不另行导航。
- 只有内容真正落到阅读位置下方才显示新内容提示；历史恢复不播到达动画，原消息气泡与同 key iframe 在重绘及提交中保留。
- 历史显示快照与流式前缀分别由 53 和 72 所有，流式前缀不得挤出历史结果。

## 脚本等待与本地资源

跨帧、初始化、库就绪、EJS、异步事件及保存等待只有调用方显式指定时限才截止，不能因等待久而无库继续发送；这不抢占任意主线程 JavaScript，也不改变同源脚本权限。两阶段初始化及事件取消边界见[兼容矩阵](COMPATIBILITY_MATRIX.md#31-iframe-宿主与直绑全局)。

停止 EJS 同时作废未提交事务与显示缓存，迟到求值不能再写变量、共享定义、正则或注入。Worker 计算保护从实际执行开始计时，不计排队与资源加载；失败隔离到调用/消息，失控时终止 Worker，环境级失败不能无限重启。显示失败保留最近快照，无快照才用原文，失败自己的重绘不立即重试。

回复保存显示后释放输入区；接收事件、自动快捷回复、摘要及 after-AI 按会话串行，后台仍可停止。停止或切换取消所属任务并释放占用，不能换新控制器复活旧工作，已完成写入不回滚；提交前整理被停止也要保留回复。

新发送等待旧任务后取得新 epoch；尾部脚本生成须识别重入，不能等待自身。过期结果不能进入下一阶段；自动快捷回复标志与生成身份同行，不依赖临时调用栈。事件异常只报告一次，回复被删除后不再处理其尾部。

可能覆盖消息的用户操作受后台守卫约束，合法脚本修改须显式传递所属任务，嵌套用户点击不能继承后台脚本身份。暂停 WebView 前同时核对保存和全部活动工作；Risu 保持独立输出生命周期，不进入 ST 提交事件队列。

### 本地发行依赖

下表是应用内置第三方库与素材的唯一登记处，许可证随文件存于同一目录：JS 库在 `app/src/main/assets/js/vendor/`，样式与字体/图片包在 `app/src/main/assets/css/vendor/<包名-版本>/`，音效在 `app/src/main/assets/audio/<用途>/`。消息前端与常驻脚本库注入的库取自原 CDN URL 指定的相同版本 npm 官方包；其中少数条目（Vue、Vue Router 的 `.prod.min.js`，jQuery UI 主题的 `theme.min.css`）在原 CDN 地址上是 jsDelivr 对 npm 包内未随附压缩版文件的自动压缩别名，内容与官方包同版本一致、字节不同；本地按 npm 包实际文件名去掉 `.min` 存放，不单独另存一份构造出的压缩件。

常驻脚本库与消息前端模板均按各自表内顺序把这些 JS/CSS 作为 `<script src>`/`<link>` 注入所属 iframe；这些全局只在对应 iframe 内可见，主页面 index 和 ESLint 全局清单无需添加。两处注入的都是本地文件；卡片自己 `import` 或引用的远程资源不受影响，保持其原语义。

Font Awesome 则必须由宿主文档提供：卡片脚本按 SillyTavern 惯例把自己的 `<link>` 放进 shadow root，而 Chromium 忽略 shadow tree 内的 `@font-face`，字体只能在 document 层注册。因此 `index.html`、常驻脚本库 frame 和消息前端 frame 都引入同一份本地文件，覆盖 6 Free / 6 Brands 及其自带的 5 / 4 别名家族。消息前端模板仍保留官方口径的 Font Awesome 7 条目并排在本地 6 之后，类名规则照旧由 7 决定；该条目同样是本地文件。

| 本地文件 | 来源 | 许可证文件 |
| --- | --- | --- |
| Vue：`js/vendor/vue-3.5.41.runtime.global.prod.js` | [Vue 3.5.41 npm 包](https://registry.npmjs.org/vue/-/vue-3.5.41.tgz)，`dist/vue.runtime.global.prod.js` | `vue-3.5.41.LICENSE` |
| Vue Router：`js/vendor/vue-router-5.2.0.global.prod.js` | [Vue Router 5.2.0 npm 包](https://registry.npmjs.org/vue-router/-/vue-router-5.2.0.tgz)，`dist/vue-router.global.prod.js` | `vue-router-5.2.0.LICENSE` |
| jQuery：`js/vendor/jquery-3.7.1.min.js` | [jQuery 3.7.1 npm 包](https://registry.npmjs.org/jquery/-/jquery-3.7.1.tgz)，`dist/jquery.min.js` | `jquery-3.7.1.LICENSE` |
| Font Awesome Free：`css/vendor/fontawesome-6.7.2/css/all.min.css` 与 `css/vendor/fontawesome-6.7.2/webfonts/*.woff2` | [Font Awesome Free 6.7.2 npm 包](https://registry.npmjs.org/@fortawesome/fontawesome-free/-/fontawesome-free-6.7.2.tgz)，`css/all.min.css` 与 `webfonts/`；只取 woff2，样式表内的 ttf 分支在支持 woff2 的 WebView 上不会请求 | `fontawesome-6.7.2/LICENSE.txt` |
| Font Awesome Free 7（消息前端专用第二份图标字体）：`css/vendor/fontawesome-7.3.1/css/all.min.css` 与 `css/vendor/fontawesome-7.3.1/webfonts/*.woff2` | [Font Awesome Free 7.3.1 npm 包](https://registry.npmjs.org/@fortawesome/fontawesome-free/-/fontawesome-free-7.3.1.tgz)，`css/all.min.css` 与 `webfonts/`；`all.min.css` 只引用这 4 个 woff2，其余格式不取 | `fontawesome-7.3.1/LICENSE.txt` |
| 夜欲宋体（Yeyu Serif SC，思源宋体 SC 中粗/粗两档子集）：`css/vendor/source-han-serif-2.003R/YeyuSerifSC-SemiBold.subset.woff2` 与 `YeyuSerifSC-Bold.subset.woff2` | [adobe-fonts/source-han-serif 2.003R](https://github.com/adobe-fonts/source-han-serif/releases/tag/2.003R) 的 `OTF/SimplifiedChinese/SourceHanSerifSC-{SemiBold,Bold}.otf`，经 pyftsubset 子集化为 woff2（默认布局特性，`--no-hinting --desubroutinize`）；子集是 OFL 修改版，不能沿用保留字体名「Source」（[OFL-FAQ 2.6](https://openfontlicense.org/ofl-faq/)），因此 name 表与 CFF 内的字体名改为 Yeyu Serif SC / `YeyuSerifSC-*`，版权、商标与许可条目原样保留；字符集为 GB2312 全部字符、Big5 常用字 A440–C67E、ASCII、Latin-1 补充、通用标点、CJK 符号与标点、全角/半角形式、平假名/片假名及字体自带的箭头与几何/杂项符号（U+2190–21FF、U+25A0–27BF）的并集，未覆盖字符由系统字体回落 | `source-han-serif-2.003R/LICENSE.txt`（SIL OFL 1.1） |
| Tailwind CSS Browser：`js/vendor/tailwind-browser-4.1.12.global.js` | [@tailwindcss/browser 4.1.12 npm 包](https://registry.npmjs.org/@tailwindcss/browser/-/browser-4.1.12.tgz)，`dist/index.global.js` | `tailwind-browser-4.1.12.LICENSE` |
| jQuery 4（消息前端专用，独立于常驻脚本库的 jQuery 3.7.1）：`js/vendor/jquery-4.0.0.min.js` | [jQuery 4.0.0 npm 包](https://registry.npmjs.org/jquery/-/jquery-4.0.0.tgz)，`dist/jquery.min.js` | `jquery-4.0.0.LICENSE` |
| jQuery UI：`js/vendor/jquery-ui-1.14.2.min.js` | [jQuery UI 1.14.2 npm 包](https://registry.npmjs.org/jquery-ui/-/jquery-ui-1.14.2.tgz)，`dist/jquery-ui.min.js` | `jquery-ui-1.14.2.LICENSE` |
| jQuery UI 主题：`css/vendor/jquery-ui-1.14.2/theme.css` 与 `css/vendor/jquery-ui-1.14.2/images/*.png` | 同一 jQuery UI 1.14.2 npm 包，`themes/base/theme.css` 与 `themes/base/images/`；原 CDN 地址请求的 `theme.min.css` 是 jsDelivr 用 clean-css 现场压缩的别名，npm 包内无对应压缩文件，故存放未压缩原文并改用不含 `.min` 的文件名 | `jquery-ui-1.14.2.LICENSE` |
| jQuery UI Touch Punch：`js/vendor/jquery-ui-touch-punch-0.2.3.min.js` | [jquery-ui-touch-punch 0.2.3 npm 包](https://registry.npmjs.org/jquery-ui-touch-punch/-/jquery-ui-touch-punch-0.2.3.tgz)，`jquery.ui.touch-punch.min.js` | `jquery-ui-touch-punch-0.2.3.LICENSE`；该包不随附独立 LICENSE 文件，许可证文本取自压缩前源文件的头部注释 |
| Showdown（`CARD_FRONTEND_PREDEFINE_RESOURCES`，消息前端与常驻脚本库共用的预定义脚本注入）：`js/vendor/showdown-2.1.0.min.js` | [showdown 2.1.0 npm 包](https://registry.npmjs.org/showdown/-/showdown-2.1.0.tgz)，`dist/showdown.min.js` | `showdown-2.1.0.LICENSE` |
| PDF.js（附件资料库 PDF 提取，主线程 fake worker）：`js/vendor/pdf-4.7.76.js` 与 `js/vendor/pdf-worker-4.7.76.js` | 固定 SillyTavern 参考的 `public/lib/pdf.min.mjs`、`pdf.worker.min.mjs`，由 `tools/probes/bundle_data_bank_pdf.js` 去掉尾部 ES export 并包成经典脚本 | `pdf-4.7.76.LICENSE`（手动放置） |
| Readability（附件资料库网页正文提取）：`js/vendor/readability-0.6.0.js` | 固定 SillyTavern 参考 `node_modules/@mozilla/readability` 的 `Readability.js` 与 `Readability-readerable.js`，由 `tools/probes/bundle_data_bank_pdf.js` 原样拼接 | `readability-0.6.0.LICENSE`（脚本从参考目录复制） |
| EJS（提示词模板）：`js/vendor/ejs-3.1.9.js` | 固定 ST-Prompt-Template 参考的 EJS 3.1.9，只把 CRLF 规范化为 LF；参考与资产 SHA-256 固定在 `tools/fixtures/prompt_template_oracle.json` | `ejs-LICENSE.txt` |
| faker（提示词模板 `faker` 对象）：`js/vendor/faker-9.7.0.js` | 固定 ST-Prompt-Template `libs` 目录的 `faker.mjs` 全部地区导出与 `buffer.mjs`，由 `tools/probes/bundle_prompt_faker.js` 合并为经典脚本 | `faker-9.7.0.LICENSE` 与 `faker-buffer.LICENSE`（均手动放置） |
| jsonrepair（提示词模板 `parseJSON`）：`js/vendor/jsonrepair-3.13.1.min.js` | jsonrepair 3.13.1 UMD 压缩版；版本与 SHA-256 固定在 `tools/fixtures/prompt_template_oracle.json` | `jsonrepair-3.13.1.LICENSE` |
| MVU 运行时（本地 Zod 模式）：`js/vendor/mvu-runtime-1.0.0.js`；供不透明 srcdoc iframe 使用的源码字符串 `js/vendor/mvu-runtime-source-1.0.0.js`，Worker 用 `js/vendor/mvu-worker-vendor-source-1.0.0.js` | 夜欲打包的 YAML 2.8.1（主运行时）与 Zod 4.1.11、Lodash 4.17.23（Worker）；`-source` 文件是同一源码的字符串形式，须与原文件逐字节同步（`mvu-runtime-source` 由 `tools/qa/check_assets.py` 校验） | `mvu-runtime-LICENSE.txt` |
| DOMPurify（Risu 隔离 HTML 的强制依赖）：`js/vendor/dompurify-3.4.5.min.js` | DOMPurify 3.4.5 官方压缩版 | `dompurify-LICENSE.txt` |
| jsdiff（Risu 历史宏与语音续写来源映射）：`js/vendor/jsdiff-9.0.0.js` | [diff 9.0.0 npm 包](https://registry.npmjs.org/diff/-/diff-9.0.0.tgz)，`dist/diff.js`；只调整外层导出以提供可序列化的 Worker 安装函数，差异算法未改 | `jsdiff-9.0.0.LICENSE`（BSD-3-Clause） |
| Wasmoon（Risu Lua）：`js/vendor/wasmoon-1.16.0.js` 与 `js/vendor/wasmoon-1.16.0-glue.js` | [wasmoon 1.16.0 npm 包](https://registry.npmjs.org/wasmoon/-/wasmoon-1.16.0.tgz)：`dist/index.js` 原文包进具名函数，`dist/glue.wasm` 存为 Base64，供 Worker 不经 fetch 重建 | `wasmoon-LICENSE.txt`（MIT） |
| 转盘音效：`audio/wheel/tick.wav` 与 `audio/wheel/settle.wav` | 本项目以确定性信号合成的单声道 PCM：55 ms 的明亮机械刻度声与 120 ms 的双击落定声；48 kHz、16-bit，峰值分别为 -13 / -9 dBFS | 自有合成素材，无第三方许可证 |
| RPack 映射（Risu `module.risum` 解码）：`js/vendor/rpack-map.js` | RisuAI 固定参考 `src/ts/rpack/rpack_map.bin` 的 512 字节，转写为 Uint8Array；固定版本与校验见 [Risu 参考](RISU_REFERENCE.md#modulerisum-固定参考) | `rpack-AGPL-3.0.txt` 与 `rpack-SOURCE.txt` |
| RisuAI 标志（Risu 卡片引用的品牌宏资产）：`risu-logo.png`（assets 根目录） | RisuAI 固定参考 `public/logo_512.png` 原字节；固定版本与校验见 [Risu 参考](RISU_REFERENCE.md#脚本触发器与-lua-宿主) | `risu-logo-GPL-3.0.txt` 与 `risu-logo-SOURCE.txt` |
| 应用图标：`res/mipmap-nodpi/ic_launcher.jpg` 与 `ic_launcher_round.jpg` | 由 OpenAI 图像生成工具制作的月牙对话气泡图案。[源图](../artwork/app-icon.png)保留了原始 PNG 格式；两个桌面图标均在不改图案的前提下等比例缩放至 512×512（JPEG 质量 95），圆形裁切由桌面环境完成 | 随项目按 [AGPL-3.0](../LICENSE) 分发 |

升级 PDF.js 或 Readability 时，先改 `tools/probes/bundle_data_bank_pdf.js` 内写死的版本断言和输出文件名（`4.7.76` → `pdf-4.7.76.js`、`pdf-worker-4.7.76.js`；`0.6.0` → `readability-0.6.0.js`），否则脚本会因版本不符直接报错或把新版本写进旧文件名；改完再用 `node tools/probes/bundle_data_bank_pdf.js <固定参考目录>` 从固定参考重新生成。升级 faker 时，先改 `tools/probes/bundle_prompt_faker.js` 内写死的输出文件名 `faker-9.7.0.js`——脚本不校验 faker 版本，不改就会把新版本写进旧文件名；改完再用 `node tools/probes/bundle_prompt_faker.js <提示词模板插件的 libs 目录>` 重新生成。两个脚本都不生成表中标注「手动放置」的许可证文件。
