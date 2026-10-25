# 架构说明

本文件维护调用链和原生/WebView 边界；持久化以 [DATA_MODEL.md](DATA_MODEL.md) 为准，逐文件职责见 [FRONTEND_MODULES.md](FRONTEND_MODULES.md)。

## 1. 总览

夜欲是单 Activity 原生壳承载的 APK 内置单页应用，面向 Android 手机单窗口竖屏；视觉验收见 [VISUAL_ACCEPTANCE.md](VISUAL_ACCEPTANCE.md)。原生负责平台能力、导航与生命周期，前端负责界面、业务状态、模型请求与数据。

```text
MainActivity
  ├─ WebChromeClient → 系统文件选择器
  ├─ AndroidBridge → 受限平台能力
  └─ assets/index.html → 经典脚本 SPA → IndexedDB / 模型 API
```

## 2. 目录职责

| 路径 | 归属 |
| --- | --- |
| `app/src/main/assets/index.html` | 页面骨架、脚本加载顺序与入口事件 |
| `app/src/main/assets/css/`、`audio/` | 视觉与音效，规则见 [DESIGN.md](../DESIGN.md)，外来资产见[本地发行依赖](FRONTEND_MODULES.md#本地发行依赖) |
| `app/src/main/assets/js/core/`、`js/app/`、`js/workers/` | 无页面 DOM 的底层引擎/仓储、业务及界面模块、Worker 入口；`js/vendor/` 见[本地发行依赖](FRONTEND_MODULES.md#本地发行依赖) |
| `app/src/main/java/com/yeyu/app/MainActivity.java` | WebView、系统栏、文件选择、返回与桥 |
| `app/src/main/AndroidManifest.xml`、`res/` | 组件、权限、窗口及应用资源 |
| `tools/` | 门禁、测试与 fixture；`probes/` 是环境取证、固定上游复现及 vendor 重打包，不进入应用运行时 |

## 3. 前端组织与协作

### 3.1 加载与启动

`index.html` 按固定顺序加载经典脚本，通过全局函数协作；跨文件同名顶层声明禁止，调整顺序须核对全局声明、DOM 引用和启动入口。全局表由 [classic_globals.js](../tools/qa/classic_globals.js) 从实际装载脚本生成；序列化进 iframe/Worker 的函数内 `window.X =` 不算主页面全局，检查配置见 [eslint.config.js](../eslint.config.js)。

`99-bootstrap.js` 经仓储读取后初始化；启动/升级边界见 [DATA_MODEL.md](DATA_MODEL.md#10-维护基线)。本地 CSS/JS 不带缓存参数：`versionCode` 变化时原生清一次资源缓存，并以 `index.html?version=<versionName>` 加载；页面显示的版本和更新比较都读取该参数，版本唯一来源仍为 `app/build.gradle.kts`。

### 3.2 仓储与生成链路

数据库事务、媒体及业务门面分别由 `repository-db.js`、`repository-media.js`、`repository.js` 所有；正式数据只走该链路。

```text
82-generation-coordinator
  → 81-generation-prompt（检索、脚本阶段、Prompt）
  → 70-api / 72-stream-response（传输与读取）
  → 64-stream-drafts（未提交 checkpoint）
  → 68-generation-commit（正式提交）
```

`62-generation-state.js` 维护生成身份与取消；包括静默、临时、结构化、嵌套请求在内的全部模型请求须登记控制器，界面空闲也提供停止入口。模型传输无默认连接/读取期限，显式脚本时限仍生效，长期无数据只提示、不中断；后台与脚本等待规则见[脚本等待与本地资源](FRONTEND_MODULES.md#脚本等待与本地资源)。

结构化结果校验与一次格式修复由 `70-api.js` 唯一负责，`85-structured-requests.js` 仅封装消费者；格式仍不合格须明确报错。正文、草稿与显示边界见[数据模型](DATA_MODEL.md#7-流式草稿-checkpoint)。

### 3.3 Prompt、世界书与显示

- 世界书、记忆共用向量检索，检索不可用不阻断发送；ST Regex、STScript、Quick Reply 各自保留执行链。
- Risu 由来源判定进入独立 CBS/脚本/显示体系，不混入 ST 正则、变量、EJS、前端或 MVU；能力例外见[兼容矩阵](COMPATIBILITY_MATRIX.md#5-risu-卡片运行体系)。
- MVU bundle 与本地回放只选一个写入者，共用候选信封，不修改角色卡源文本。
- 卡片网页与常驻脚本库运行在同源 iframe，可访问宿主；公开写入归 `74-host-write-contract.js`，失效 owner 不得写入；挂载产品取舍见[消息前端挂载调度](FRONTEND_MODULES.md#消息前端挂载调度)。
- `57-preset-manager.js` 唯一拥有 ST raw 与出站顺序；预览和实发共用 `81-generation-prompt.js`，helper 共用暂态锁，最终消息与协议视图共用 `70-api.js`。
- 预览真实干跑 EJS、MVU、注入过滤及卡片发送事件；宿主写入留在副本或事务，模型调用回占位并注记，原有卡片联网仍真实执行；取消不撤回已经发生的远端动作，同轮复用边界见[兼容矩阵](COMPATIBILITY_MATRIX.md#联网与同轮复用)。
- 预览不与派发卡片事件的生成及其尾部处理重叠，翻译等不触达卡片脚本的请求不影响它；共享本轮随机、可复用网络结果和检索缓存，但第三方脚本自己的随机、时间与 dryRun 分支不保证逐字相同。

显示副本与持久消息的规则归 [DATA_MODEL.md](DATA_MODEL.md)，受保护默认 Prompt 的边界见 [§9](#9-产品边界)。

### 3.4 专项功能

转盘由本地纯引擎计算并提交每轮结果，只有终点人物志请求模型；方案管理与对局 UI 分归 43/44。各类导入走各领域所有者，原子性、未知字段及格式边界见 [DATA_MODEL.md](DATA_MODEL.md#8-导入与未知字段)。

语音由 `84-speech.js` 单独调用 OpenAI 兼容 `/audio/speech` 或 MiniMax `t2a_v2`，不复用聊天模型路由；协议依据为 [OpenAI Speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create) 与 [MiniMax T2A HTTP](https://platform.minimax.io/docs/api-reference/speech-t2a-http)。生成正式提交后从显示 DOM 提取文字；对白模式按引号提取，保留动作、斜体或旁白样式中的对白，仍排除隐藏、未展开折叠与剧情选项；续写仅合成显示新增部分；显式脚本朗读按传入文字执行。切会话、新一轮生成、关闭自动朗读或应用进入后台会取消请求并停止播放。使用既有生命周期回调，不新增原生桥方法或权限。

### 3.5 请求路由

普通/专项路由与输出上限归[数据模型](DATA_MODEL.md#2-主要对象与设置)。`fetchCompatibleCompletion` 是唯一协议翻译点：调用方组装 OpenAI 形状，06 负责原生端点、鉴权及参数转换，再把响应包回公共形状；思考映射、预填能力与官方依据以该文件常量为准。

- 用户明确关闭思考被拒绝时保留供应商错误，不能静默回退自动；内部辅助任务才可用不可关闭模型的最低档。原生结构化输出沿用所选思考档，不套用 OpenAI 兼容线路的强制关闭处理。
- helper 显式 JSON Schema 经同一生成链路翻译；Anthropic 的 `output_config.format` 与思考 effort 合并，保留 schema 原约束，不在客户端弱化供应商不支持的特性。结构化请求的拒绝和截断先于格式成功判断，不进入格式修复。
- 参数协商仅在 4xx 原文明示单个可协商参数时删该项重试，不凭猜测吞错误；非 2xx、200 顶层 error、流式 error 与安全拦截均须保留原始原因，已有正文不因结束原因丢失，拦截不得自动续写。
- Gemini 原生及兼容请求只有在 400 明示拒绝末尾 model 轮次时，才保留全部原消息并追加 user 续写提示重试；接受原请求的旧模型不改写末尾预填。规则作用请求副本，不改用户预设或历史。
- `custom_api.apiurl` 与 `xbgenraw.apiurl` 覆盖地址时，只在协议、主机和有效端口同源时保留当前路由凭据及 headers；跨源清空继承的 Key/headers，再应用调用者自己的凭据。单次覆盖不修改供应商设置。
- Anthropic/Gemini 流须有协议结束事件或结束原因才算完成；正常 EOF 缺少终止信号按中断保留正文，非 JSON 单帧跳过。已有正文或推理内容时不自动重试；helper 收到终止标记后不再消费后续事件。
- 连通性测试使用当前未保存的表单路由，经真实传输/消费者发送最短非流式请求，可取消但不写对话和设置；其显式检测期限与正常生成的无默认期限分开。

Grok 订阅由 `07-grok-subscription.js` 所有：授权及续期只访问固定 `auth.x.ai`，授权链接只接受 `https://accounts.x.ai/oauth2/device` 并交系统浏览器；凭据只发往 `api.x.ai/v1` 的聊天、模型及图片白名单端点，不接受自定义地址/鉴权头。网络失败不清账号，明确失效凭据才清除并要求重登；并发刷新共用一次，401 只刷新重试一次。

以下外部依据解释不能仅从协议代码推导的取舍：

- 主对话类请求以合法会话 id 附带 `x-grok-conv-id` 争取同机缓存，辅助任务不带；依据为 [Maximizing Cache Hits](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits)（2026-10-03 核对）。
- 历史助手只回传正文、不回传 `reasoning_content`：缓存说明要求的是加密思考，而 [Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning) 的该能力只属于 Responses API，当前 Chat Completions 无对应字段，其多轮示例同样只追加正文。
- [OIDC discovery](https://auth.x.ai/.well-known/openid-configuration) 与[模型列表](https://docs.x.ai/developers/rest-api-reference/inference/models) 是公开依据（2026-09-25 核对）；设备码订阅接口尚非开发者文档承诺接口，模型从直连端点检测，不能把 CLI 专用目录当作可用清单。

## 4. WebView 创建与恢复

每次创建/崩溃恢复都先配置导航、注册受限桥，再挂载加载页面；业务脚本运行前桥必须可用。重复 renderer 崩溃达到保护阈值后交用户重载，不能无限自动重建，系统回收不计入崩溃。

后台持久化完成且活动工作结束才暂停；`pauseTimers` 是进程级状态，新 WebView 挂载和 Activity 回前台必须无条件 `resumeTimers`。方向、分屏、小窗和 uiMode 由 Activity 接管，不重建 WebView；应用固定浅色，系统深色模式不改页面外观。

## 5. 数据边界

[DATA_MODEL.md](DATA_MODEL.md) 是 Store、字段、持久化三态、媒体、草稿与升级的唯一合同；读取失败进入恢复界面，不得以空内存覆盖数据库，页面派生状态不得自行扩张为持久字段。

## 6. 原生桥与导航边界

WebView 远程调试常开，仅在设备开启 USB 调试并授权主机时可连。

`setAllowUniversalAccessFromFileURLs(true)` 是允许内置 file 页面直连未开放 CORS 供应商的产品取舍；同源卡片帧和带 allow-same-origin 的 Risu 帧也继承此访问能力，不新增通用原生网络接口。Risu 消息帧额外用 allow-forms 派发表单提交事件，仍禁脚本；CSP form-action 'none' 与宿主 preventDefault 阻止导航。

`AndroidBridge` 白名单由 `MainActivity.java` 的 `@JavascriptInterface` 声明维护，仅承担预设保存、系统栏、卡片全屏方向、图片下载/取消、暂停握手和长按触感；不得扩展为通用文件系统、网络或命令接口。图片下载允许 HTTP(S) 本机/局域网/自定义端口，保留重定向、实际解码与系统证书校验，只设连接/单次读取超时，不设总期限或大小上限。

顶层仅加载内置 `index.html?version=<versionName>`，HTTP(S) 导航交系统浏览器，其余本地或自定义 scheme 阻止。安全区与 IME 可用视口由原生生命周期统一同步，聊天只补未被系统缩放处理的剩余高度，弹窗按同一可用视口限高；不提供前端键盘适配开关。

普通消息富文本在前端取消表单默认提交，保留按钮和脚本事件交互，不依赖不覆盖 POST 的原生导航回调；CSS 重写后的样式文本和行内值在序列化前转义 `<`，避免再次解析 HTML 时闭合标签。

Android 返回先关闭前端当前层，无层才退出 Activity；文件选择用系统选择器，预设导出用受限桥和 MediaStore，触感跟随系统设置而不新增震动权限。

## 7. 构建边界

身份、SDK 与版本取自 `app/build.gradle.kts`，名称图标取自 `res/`；身份约束见 [§9](#9-产品边界)，构建发布归 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)。

## 8. 兼容能力边界

生态例外、拒绝项及上游差异见 [COMPATIBILITY_MATRIX.md](COMPATIBILITY_MATRIX.md)，固定参考身份见 [SILLYTAVERN_REFERENCE.md](SILLYTAVERN_REFERENCE.md#固定身份)。

## 9. 产品边界

- 包名固定为 `com.yeyu.app`。官方发布 APK 的签名证书 SHA-256 为 `626d882b93d4a37ac03ecce4c177cd8321a83f6856969718c808e8faabf07bc5`，覆盖安装官方版必须使用同一证书。正式 APK 必须由 Gradle 生成，不得 ZIP 替换、二进制修改或 apktool 重打包。
- 角色卡、世界书、人格、原始聊天、媒体、API 设置和未知主数据字段不得因整理、升级或候选清理删除；持久化、迁移和派生数据以 [DATA_MODEL.md](DATA_MODEL.md) 为准。
- `00-defaults.js` 的全部 `DEFAULT_*` 和所有助手 `defaultText` 受保护，身份与哈希以 `tools/fixtures/protected_prompt_manifest.json` 为准，哈希取求值后的文本，`${}` 引用的常量同样受保护，门禁入口是 `tools/qa/protected_prompts.js`；改动须经维护者明确决定，并同步清单。
- 默认只加载 `file:///android_asset/index.html`；外部导航须经 scheme/host allowlist 或交给系统浏览器。`addJavascriptInterface` 只暴露必要的 `@JavascriptInterface` 白名单方法，不得扩展为通用文件、网络或命令接口，见 [§6](#6-原生桥与导航边界)。
- 普通和圆形图标使用 [月牙对话气泡源图](../artwork/app-icon.png)，保留月牙、气泡尾部、星芒与配色；保留文件选择器与 `AndroidBridge.saveFile`（仅预设导出）；不增加无必要权限。更新检查只读取公开仓库的最新正式发布信息，下载交给系统浏览器，不做后台服务、系统通知或静默安装。
