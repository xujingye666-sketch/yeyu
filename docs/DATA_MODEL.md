# 数据模型约定

本文只维护数据归属、保真、安全边界和产品取舍；字段形状与算法查各节代码入口，生态差异查 [COMPATIBILITY_MATRIX.md](COMPATIBILITY_MATRIX.md)。调用边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。

角色、人格、世界书、转盘方案及进度、原始聊天、媒体、设置、用户 Prompt 覆盖和已知主数据对象内部的未知字段，不得因规范化、恢复、整理或导入丢失。`rawCard`、世界书 `_raw` 与导入来源是原始证据；运行副本不得覆盖它们。删除具体未知字段须有用户授权。

## 1. Store 与组合数据

IndexedDB schema v4 固定八个 Store：`app_meta`、`characters`、`personas`、`worldbook`、`sessions`、`wheel_schemes`、`media`、`vector_cache`。前七项分别承载元信息/设置/草稿、角色、人格、世界书、会话、转盘和 Blob；`vector_cache` 是可重建派生缓存，不含 Key 凭据。结构与事务入口见 [repository-db.js](../app/src/main/assets/js/core/repository-db.js)、[repository.js](../app/src/main/assets/js/core/repository.js)。

仓储组合出的业务对象不是额外 Store；正式数据只走结构化仓储，不退回整包快照作为主存储。恢复快照仅用于 [§3](#3-持久化三态与恢复) 的本机降级。

更新检查状态（上次自动检查时间、最近查到的正式发布、已主动提醒的版本）存于页面 localStorage 的 `yeyu_update_check_v1`，不属于主数据也不进仓储；丢失只会提前再检查或再提醒一次。

## 2. 主要对象与设置

### 2.1 角色、人格与世界书

- 普通编辑以原对象为底稿，只覆盖表单负责的字段，保留未知字段、原始证据及缺失/空值语义。头像和背景可以主动清除或替换；同来源开场媒体保留字节、引用与扩展。失败只撤销本次写入，保留对象身份、媒体和等待期间的并发改动。
- 每个角色最多绑定一个人格；身份依次取角色绑定、全局活动人格、默认用户。全局默认与角色绑定可以共存，切换或修改任一选择不清空另一选择；人格编辑保留脚本元数据。
- 世界书的全局、角色主绑定、角色附加绑定、人格和聊天绑定彼此独立，运行时按分类 id 去重。条目 id 在分类内唯一，冲突处理不改变正文、顺序或未知字段。重命名和删除维护所有绑定。TavernHelper 按精确书名写入，重名报错，uid 0 有效；只逆映射公开字段，未知字段与来源内容保留。具体读写合同由 [host_write_contract_oracle.json](../tools/fixtures/host_write_contract_oracle.json) 和 [74-host-write-contract.js](../app/src/main/assets/js/app/74-host-write-contract.js) 固定。
- ST 正则的唯一所有者为全局设置、活动 raw 预设和角色，按此顺序消费，保持存储顺序与未知字段。显示和发送只改派生副本；编辑保存才按 ST `runOnEdit` 语义改正文。世界书正文只在发送阶段应用正则，结果不回写源条目，也不参与触发与递归。缓存必须隔离变量快照与晚到结果。
- `scriptsEnabled` 控制角色可执行脚本/前端；`regexEnabled` 独立控制角色正则，缺失视为开启，全局与预设正则不受它影响。旧 `scriptState` 和私有扩展保真但不运行。
- **EJS 提示词模板不受以上开关或导入模式约束**：角色字段、世界书、预设、消息与正则输出的模板在宿主主页面照常求值，可读写全部宿主数据（含 API 凭据）并联网；这是与安装模板扩展后的 ST 一致的既定边界。Worker、错误与按钮忙碌状态不持久化。

#### 2.1.1 脚本实体、注入与变量界面

实体与脚本入口见 [74-host-imports.js](../app/src/main/assets/js/app/74-host-imports.js)、[74-host-prompts.js](../app/src/main/assets/js/app/74-host-prompts.js)、[74-host-variable-ui.js](../app/src/main/assets/js/app/74-host-variable-ui.js)。

角色/人格 API 使用原生 id，avatar 身份与地址分离。删除角色会删除其会话，来源世界书不随之删除。

同名原始卡替换以新卡整份字段、`extensions` 和 `rawCard` 为准，仅搬运夜欲本地状态：收藏、脚本/正则开关、背景选择、组件导入模式、表情配置、Risu 世界书状态；新卡缺少时保留中文显示名及头像/背景；创作者注释未变时保留已读标记与旧译文（新卡译文优先）。被表情、任一角色背景或会话背景锁引用而新卡未提供同 id 的素材，连同字节保留。角色 id、会话、人格和世界书绑定保留；随卡世界书配对见 [§8](#8-导入与未知字段)。角色脚本变量使用新卡数据，不夹带旧卡变量。

**卡片写入全局正则按写入角色归属**：`ownerCharacterId` 缺失是用户行，旧行不迁移；卡片写入的新行只对该角色生效，不受角色正则开关影响，不进入角色导出、依赖报告或 character 正则视图，删除角色时一并删除。global 读取/替换只能触及用户行和本角色行，隐藏行保留原位置；已有行保留归属、`imported` 与未改内容，新行不标 imported。id 只要求同一归属内唯一。此规则防止一张卡污染其他角色，是有意区别于 ST 全局表的选择。

通用注入的持久 owner 是 `session.promptInjections`；清空/替换聊天时清除，once 在生成成功或停止时清除。`injectPrompts` 与 facade `setExtensionPrompt` 共用会话 id 命名空间，后写覆盖，只有最后来源为 injectPrompts 的记录落库；任一注销入口都能移除两种来源。facade 注入、函数 filter 与 frame 登记只驻内存，frame 失效、禁用/替换脚本、清空或重载时释放；STScript 文本 filter 的恢复见 [§2.3.1](#231-stscript-命令状态)。请求 injects 与模板 injectPrompt 各自属于请求/模板，不复制进持久表。

变量复用原 owner：global/chat 为 STScript 全局/会话变量，character/preset 为原 `tavern_helper.variables`，extension 为全局 extension settings，script 为原节点 `data`，message 为当前 MVU 候选。MVU 保留字段与 chatMetadata.variables 只是投影，不建第二份变量袋；角色变量容器原位保留，聚合不暗中合入 preset/extension。

变量 schema 只供 UI，不 parse、不补默认值、不落库；生命周期由变量 UI 入口管理，重载全清。脚本库编辑只改原节点 data。Mvu 有 bundle 时由 bundle 唯一写入，无 bundle 的单一 Zod 模式才本地回放，不增加并行旧版引擎。

#### 2.1.2 附件资料库

入口见 [49-data-bank.js](../app/src/main/assets/js/app/49-data-bank.js)、[49-data-bank-import.js](../app/src/main/assets/js/app/49-data-bank-import.js)。

全局、角色、会话各持有附件元数据，全文只存 `media`，按需读取；附件 `url` 是稳定本机身份，不是 HTTP 地址。文本与引用同事务提交，未知字段保留。资料库、长记忆和 `/vector-query` 共用查询消息数，不设第二份值。

全文和元数据是主数据，片段向量与检索结果是派生数据：purge 只清索引，结果不写原始聊天。最后一个所有者删除并成功保存后才清 Blob 与片段向量；普通 meta/session 保存不触发媒体全量清理，共享引用按 [§6](#6-媒体引用与清理) 保留。

#### 2.1.3 角色立绘与表情

角色持有表情配置，会话持有本次选择；同图多绑定共享 Blob。解绑/替换只改目标，删除默认绑定须记排除，避免自动派生回来。`#reset` 只清当前会话并隐藏舞台；失败保留资产身份及共享消费者。

远程声明下载/解码/保存后显示，失败显式重试；无来源绑定保留，提示补入。分类/绘制状态不落库或写正文，全局提示词不复制进角色；会话立绘不属于角色卡。应用**不提供角色卡导出**。入口见 [45-expressions.js](../app/src/main/assets/js/app/45-expressions.js)。

#### 2.1.4 聊天补全预设

raw 消费与编排见 [57-preset-manager.js](../app/src/main/assets/js/app/57-preset-manager.js)，格式判据采用 [ST 固定参考](SILLYTAVERN_REFERENCE.md#语义复现入口)。

- 完整 ST raw JSON 原样保存，不做认识字段的白名单裁剪。活动 raw 由 `chatCompletionPresetInUse` 唯一持有，具名身份与 raw 是否存在是两个问题；名称为空仍可持有 raw。活动 raw 为空时每次从当前受保护默认生成，随版本更新；此时预设变量、正则和脚本树只写 `chatCompletionPresetDefaultExtensions`，不凭一次脚本写入冻结默认编排或创建具名预设。活动 raw 存在时写回它；具名副本和已开草稿同步，不能建立第二套模型。
- 出站顺序/启停以 `character_id=100001` 行为准，不合并或回落 `100000`。导入缺行时补 ST 默认顺序并披露，原行、孤儿引用、未知 marker/utility、顶层键和 `extensions` 保留；未消费项不出站并披露。
- 条目按类型处理，中文显示不改 name。新建为空白 ST 骨架，复制整份 raw；已存默认副本不随版本迁移。采样/思考/供应商字段只保真，参数取设置；未操作开关不重写类型限制。
- 管理器使用独立草稿，“完成”只改草稿，底部“保存”才切换运行态；取消丢弃。变化比较保留数组顺序、缺失/null 差异，忽略对象键顺序与仅 CRLF/LF 的差异。条目只写实际改动的字段。切换或保存失败只撤销本次设置/条目，不能用整包聊天快照覆盖并发消息。
- 导出只在副本上递归去除 API Key、OAuth 凭据、`reverse_proxy`、`proxy_password` 和整项 `custom_include_headers`（含 JSON 编码对象）。后者按 SillyTavern 的敏感字段口径整体去除，避免 Authorization 等自定义认证头外泄；只有实际删除字段才重写该字符串，其他未知字段及原预设不变。实现入口为 [pure.js](../app/src/main/assets/js/core/pure.js) 的 `redactExportCredentials`。

#### 2.1.5 世界书条目字段映射

完整映射与优先级以 [50-worldbook.js](../app/src/main/assets/js/app/50-worldbook.js) 的 `normalizeWBEntry`、`wbEntryPositionSource` 等读函数为准；只生成运行副本，未采用来源原样留在 `extensions/_raw`，读取补默认值不写回源字段。

例外：数值 extensions.position 优先顶层，decorator 再优先；常驻优先向量；条目/全局深度 0 不建窗口，书级 0 回落全局。ST 不读取卡内 use_regex，夜欲已存 useRegex 保留；正则关键词的导入/汉化/匹配同口径，存量 id/旧标记不迁移。不安全或无效正则不触发。

### 2.2 会话与转盘方案

会话局部状态随分支复制，清空时移除已知剧情状态（含旧 scriptState、宏/STScript 变量、剧情方向、作者注、聊天元数据、世界书绑定、快捷栏、音频）；全局变量和未知主数据保留。清空须重验目标与后代，失败恢复原消息、会话对象及检查点引用并保留并发变更，序号继续单调分配；成功后才清旧音频运行态。Risu toggle 的继承取舍见 [RISU_REFERENCE.md](RISU_REFERENCE.md#未接项与上游差异)。

`/sys` 是正式 Prompt 消息；内部注释/回退排除。`/imagine` system 图不进 Prompt、记忆、搜索或正则深度，无候选；摘要不能静默删它。

ST 历史写宏只执行新写部分一次，pending 标记与变量同事务；续写只标新增，历史重读/重启/预算预估不重放，原文不改。读宏仍动态展开。global 宏与 STScript 共用全局变量；不新增固定 ST 未有的具名 tempvar 宏族。

转盘保存原 `document` 与一份当前 `progress`，计算使用规范化副本，不改导入的未知字段。配色只存本地记录、不回写 document；新方案得到颜色后才创建，重试/取消不留半记录，旧记录不触发模型重新配色。每次确认先本机结算并保存；人物志生成只驻内存，完整新稿成功才替换旧稿，重试不重复抽取。格式和状态机查 [wheel-scheme-engine.js](../app/src/main/assets/js/core/wheel-scheme-engine.js)，配色产品约定见 [DESIGN.md](../DESIGN.md)。

### 2.3 设置与任务路由

设置规范化与字段查 [05-runtime.js](../app/src/main/assets/js/app/05-runtime.js)，请求参数查 [06-provider-protocols.js](../app/src/main/assets/js/app/06-provider-protocols.js)、[70-api.js](../app/src/main/assets/js/app/70-api.js)。凭据只属于本机设置，未知主字段保留；供应商拒绝参数不产生持久化修正。

供应商地址保存原值，版本段等规范化只改请求副本。Grok 同机共用账号、固定官方地址，不用自填 Key；登录/续期/退出立即保存，不受表单取消影响，退出删凭据并停止请求；脱敏见 [§2.1.4](#214-聊天补全预设)。

语音由 `settings.speech` 唯一持有：自动开关、全文/对白范围、全局声音及按角色 id 索引的整套覆盖。声音包含协议、服务凭据、模型、音色和听感参数；未覆盖角色动态沿用全局默认，不写 `rawCard` 或生态扩展。同卡替换保持 id，故声音绑定保留；删除角色时在同一保存事务中移除该绑定。无 schema 升级。音频、请求、播放状态与缓存只在本次运行内存中，不进入仓储。

图片来源独立于聊天供应商、默认空；Grok 复用账号，来源 Key 脱敏，检测只改草稿。实际发送的提示词随图保存。形状/参数查 normalizeImageSourceRecord 与 [86-image-generation.js](../app/src/main/assets/js/app/86-image-generation.js)。

路由缺失/inherit 跟随普通设置；代拟全未配置时沿用主对话含连接档，配置后按一般路由回落；未知路由保留。预设内嵌任务默认关闭，定义留 raw，运行态不落库。已启用的角色载入任务在恢复当前角色或切换角色、会话身份稳定后执行；同次载入不重复执行，离开角色取消所属任务。包含生成操作的任务会使用已配置模型。

设置页面供应商、密钥、路由、标签模板、命名系统提示词和图片来源共用草稿，保存才落盘，取消/回聊天丢弃；途经预设/记忆页回设置保留。请求及别页保存只读已保存配置；STScript 直接保存的实际差异合入草稿，不覆盖其他未保存字段。作者注由 settings 唯一持有，管理器随底部保存提交。

**输出/进入量上限的 0 和留空均表示不限**，默认 0。OpenAI/Gemini 不发送输出限制；Anthropic 必填 max_tokens 的协议补值与思考预算下限属于传输实现，用户正数照用。普通回复、文风检查、人物志、记忆/回归结构化请求各有独立上限，人物志忽略普通上限；命令显式长度按命令自身语义。世界书固定正数上限与有效比例预算同时存在时取较小值，比例只有上下文上限与比例都正数才生效；Risu 卡 token budget 缺省/0 也不限，是避免整书静默失效的有意上游差异。辅助记忆预算 0 表示带入全部重排结果。

提示词覆盖只保存与当前受保护默认不同的值，相同则删键，缺键随版本读取当前默认。卡片汉化、世界书汉化、记忆整理的空串表示主动清空；其他设置提示词清空恢复默认。各编辑页只保存自己拥有的分组，不覆盖另一页面较新值。读写入口见 [20-prompt-memory-settings.js](../app/src/main/assets/js/app/20-prompt-memory-settings.js)。

卡片前端/常驻脚本直接使用页面真实 localStorage，无角色代管垫片。官方 extension settings 是应用级唯一树，基于 frame 初始快照只合入实际改键，旧快照不能覆盖宿主新写入。脚本树、按钮、info、data 原位写回导入容器，保留包装节点和未知字段；异步 updater 返回后重验 owner，退役 frame 拒绝写入。音频全局设置与会话播放列表分别落 meta/sessions，播放进度、音源、元素和错误不持久化。

Quick Reply 导入只入库不绑定，角色绑定不写卡，会话绑定随清空删；yeyuSource 记本次本机来源，覆盖文件同名值，缺键表示旧来源未记录。

#### 2.3.1 STScript 命令状态

命令不创建第二份业务数据，读写原 owner；完整命令与默认值查 [66-stscript-commands.js](../app/src/main/assets/js/app/66-stscript-commands.js) 及拆分注册模块。

- 停止串/前缀/流式按聊天适用范围消费，辅助请求不套限制；关闭流式不改正文/思考保存，作者注频率 0 停用。管理器未改字段不能覆盖命令新值。
- 连接档只覆盖 chat；api/model 命令解除覆盖而保留档，辅助任务走模型预设。关闭系统提示词保留选择。
- 持久注入的文本 filter 可重建，函数/句柄不存档；重载后解析失败按无 filter 注入，执行异常跳过条目。空 rawText 闭包拒绝写入/删除，过滤闭包停止不冒充生成本身取消。
- pick 种子、人格锁、临时用户名属于会话，分支复制/清空移除；pick 不绑定 ST 服务器身份。背景锁优先，仅存引用。删检查点/清空维护父消息关联，级联删除确认全部后代。
- 旧消息 `borrowedCharacterId/toolInvocations/toolCallContent/toolCallReasoning` 保真但不影响头像、Prompt 或协议。`reasoningMs` 只供显示，不能改变发送或记忆。加载遮罩、弹窗、剪贴板、DOM 变量只在运行时。
- ST 媒体存 `extra.media`，夜欲生图存候选图片；脚本读视图仅把夜欲图投影到 extra.media（带 `yeyu_image_id`），object URL 只在已读入并显示时有效。写回剔除投影项，以剩下 ST 媒体为准：脚本可以删除 ST 媒体，不能由投影删除夜欲图；后者由夜欲删候选/消息/会话/图片入口管理。未提供 media 保留，显式空数组清空 ST 媒体。多图当前页不落库。

## 3. 持久化三态与恢复

保存只提交脏分区，数据库事务完成后才关连接。每批提交独立返回结果，后批失败不撤销已成功批次。结果只有三态：IndexedDB 成功清恢复快照；IndexedDB 失败但完整本机恢复快照成功视为已保存、保留待补写；两者失败才抛错并撤销原子操作。恢复快照同时保留已成功提交的草稿删除意图，重启不恢复这些旧草稿，主库补写时原子删除。不得把渲染失败误当保存失败。二进制 sidecar 按路径存 Uint8Array/Blob 字节与 MIME，不借主数据标记字段；恢复不得依赖远程重下载，编码期间新保存须重新捕获最新数据。

**读异常与成功读到空库不同**：读/初始化失败时禁止普通保存、后台排空和待补写，不能用初始化空对象覆盖数据库或删快照。快照可用但主库不可读时只读展示，横幅常驻、发送拒绝启动；不自动回写。

主库读取成功且快照较新，才自动补写全分区；补写成功前保留降级提示。主库不可读的只读回退只有用户点“重新尝试保存”、确认用快照覆盖数据库后才允许一次写回，失败重新只读。健康/重试状态不进入 schema。

恢复页和只读回退草稿只读入内存，不核对/清理/自动保存；确认写入成功后处理。只有成功确认空库且快照损坏才提供“重新开始”，再次确认并重验同一空库/快照后才删除重载；不可读、有数据或快照变动拒绝。实现见 repository 与 [05-runtime.js](../app/src/main/assets/js/app/05-runtime.js)、[99-bootstrap.js](../app/src/main/assets/js/app/99-bootstrap.js)。

## 4. 消息、会话与派生显示

消息、候选与事务入口见 [81-message-transactions.js](../app/src/main/assets/js/app/81-message-transactions.js)、[68-generation-commit.js](../app/src/main/assets/js/app/68-generation-commit.js)、[74-host-write-contract.js](../app/src/main/assets/js/app/74-host-write-contract.js)。

- `content` 保存完整收到的原文，思考独立保存。显示、翻译、Prompt、记忆各自派生，隐藏、清洗、乱码猜测不能回写。主聊天请求只剥离较早 user 消息中的【…】回合参数，最新 user 与辅助上下文保留；预算按剥离后的文本计，剥离后无文本且无图片的历史不占预算。续写直接拼接完整前半段和新原文，不裁边缘空白或整理控制标签；一级撤销只保留上次前半段。
- 翻译的 `original_content` 只存首次翻译前完整正文，失败/截断/取消不能覆盖；候选/开场切换、再生与续写先还原原文再丢翻译标记。Risu 只翻译当前可见分支，其他分支与条件标记逐字保留，再译取原文对应段，恢复仍回完整原文。成对宏整体保护，含自然语言的 random 宏及 code/func 体不送翻译，是既定取舍。
- 译文新增内部占位符残留、或宏/隐藏触发串/自然语言围栏的占位符未归位必须拒绝写回并保留原文；原文字面同种同编号 token 按数量豁免。媒体/HTML/URL 占位缺失沿用补到段尾。占位处理查 [10-ui-core.js](../app/src/main/assets/js/app/10-ui-core.js)。
- 会话创建时独占当时开场 swipes，后改角色卡只影响新会话；空白开场保留位置，已有 openingIndex 不重算。只有正文仍对应角色卡开场的候选才补媒体。ST/Risu greeting decorator 按各自卡内位置，不按过滤后数组猜下标。
- `seq` 单调分配、不复用，记忆证据和分支边界引用它；显示/Prompt 顺序由数组位置决定，不要求 seq 排序。既有唯一正 seq 不改，同号保留首条，新消息及缺号/后续重复项分配高于既有上限的身份，重复规范化稳定。生成、异步编辑和删除以 seq/对象/候选身份定位，正文相同不能代替身份；目标移除或已非助手消息拒绝提交。
- 思考、生成元数据和夜欲图片均归候选：活动候选在消息级，其余各自在 `swipeReasoning/swipeGenerationMeta/swipeImages`；切换/增删一起对账，隐藏追加不污染当前显示。新候选从空图开始。旧多候选消息缺分格时，思考/元数据只读归末尾候选；开场白或末尾为隐藏草稿、addswipe 时归当前候选。消息级图片始终归当前候选，不用旧思考规则推断；首次改动才落实分格，不批量迁移。
- 供应商拒答/过滤结束正文照存并提示，不标未完成。已保存的末尾中断助手正文在用户直接发下一条时视为接受，清未完成/中断/草稿来源但保留正文、思考和其他元数据，与新用户消息同事务保存，失败一并恢复。
- MVU 信封随消息/分支保存，bundle 与 Zod 后备共用格式、任一时刻只有一个写入者；每候选从同一前状态计算，仅活动候选推进下游。原正文、swipes 和脚本不改，Worker/当前态缓存不落库；bundle 的 message_received 写入属于正式回复同一提交窗口，不重复 generation_ended。
- `saveChat()` 仅修改脚本自有未知字段，不能经它改 role/content、思考、候选、生成、MVU、分支或缓存；消息 API 原子修改同一消息 owner，并同步失效依赖。异步失败只撤销所属写入，保留并发数据及原对象身份，不覆盖整个数据树。
- HTML/CSS 仅在显示副本清洗和隔离，危险脚本/链接/嵌入及覆盖宿主的样式不执行；远程媒体可直载，失败占位不改原文、角色或导入源。世界书徽标只取助手消息保存的该次命中指标。

剧情方向保存原目标、预算与回合归属账本，阶段/余量从有效消息派生。宿主提交固定当时目标，脚本直接插入回合按顺序补记；无目标时已检查的回合不追溯分配。中断暂不计数、接受后恢复原归属，删除目标不把其旧归属转给后续目标。

每次 Prompt 构建全量重扫世界书、角色字段和记忆，不在消息保存构建快照；长记忆及引导词放历史末尾，避免易变内容打断稳定前缀。仅世界书时序状态属于会话，源字段或绑定变动即失效；旧 cacheContext/worldBookSnapshot/authorNoteContext 等构建残留加载时剥离，也不进脚本视图。

分支/检查点复制父会话**当前整份 Risu 状态**，不回推分叉时状态，之后独立；普通消息与 v5 派生内容按分支点复制。回归核对父线锚点，mergeId 保证原子、幂等、可撤销；回归卡作为普通主线消息参与 Prompt/摘要。

## 5. memory v5

每会话只有一份 v5 memory；形状、摘要边界与长度限制见 [21-layered-memory.js](../app/src/main/assets/js/app/21-layered-memory.js)，纯模型见 [pure.js](../app/src/main/assets/js/core/pure.js)。

- 历史摘要按 seq 来源范围与 hash 留证，近期/久远层原子替换；源消息重排不能拆开相同分支锚点或形成不推进边界。原始消息始终保留。
- 模型长期条目仅含角色事实、关系变化、关键事件，剧情时间必须有剧情证据，不按现实日期/轮数推测。同批语义重复合并证据。钱财、库存、阵容、等级、伤势、位置等易变快照不生成长期条目，已识别标 stale；用户手工条目仍由用户管理。
- 长期条目 ID 在会话内唯一；旧重复身份保留各条正文，歧义关联保留到各个对应条目。`userMaintained` 为可选人工维护标识：新自动条目为 false，人工新增、编辑、停用或恢复为 true；仅明确为 false 的自动条目受容量裁剪。旧条目无法由来源或时间戳可靠辨认是否人工修改，缺标识时保留，既有 stale 状态不据此复活。
- 只检索 active，索引/评分/结果内存重建，向量仅写派生 cache。嵌入响应缺项、重复/越界 index 或空向量整批拒绝，已完成批次缓存保留。
- 自动、手动与回归整理先进内存预览，确认才写用户编辑的摘要与勾选条目，丢弃不改数据，重启丢批次；待确认不重复生成。请求前固定源正文和基础摘要，返回时与确认前均核对源 seq/hash 和整份基础摘要，有变化按丢弃。`/summarize` 同步命令直接写但同样核对，不符返回空串并提示。
- 模型超硬上限按原位置截断并在预览逐层提示；用户改写摘要超过两层上限与前缀之和（`MEMORY_V5_DETAIL_TEXT_MAX_CHARS`）则拒绝写入。用户改写正文就是发送文本，不加派生前缀，清久远层并作为近期层进入下一轮；未改预填则保留原分层。
- 编辑、删除、恢复、再生或分支覆盖摘要来源，摘要整体失效，受影响长期条目 stale；可重建派生数据不能成为删原始消息的依据。

## 6. 媒体引用与清理

拆存、引用扫描与会话图片 walker 的唯一入口见 [repository-media.js](../app/src/main/assets/js/core/repository-media.js)。

Data URL 可作为表单输入，写库转 Blob + 引用/签名，展示用按需水合的 object URL；不把 Data URL 或页面 URL 当持久身份。共享 Blob 复用 URL，内容替换后新 DOM 接管才释放旧 URL；仍存在角色的头像/背景及正在显示的选定背景不能提前释放。

消息各候选图片、Risu inlays 和 viewScreenImage 共用 walker 拆存/汇总；未提交 Blob 留在内存及恢复 sidecar，成功才摘掉。分支/检查点共享媒体键；删除引用成功保存后才回收。清理与所有分区已提交引用的读取在同一事务中完成，汇总角色、人格、媒体资产与会话，尚未提交的内存变化不参与回收判断；归属不明或仍共享的 Blob 保留。同旧键不同内容写新签名键，不能覆盖别人引用的字节。Risu inlays 按会话持有，不能凭静态正文猜测回收。

单图删除只摘发起时消息/候选/图片的目标引用，保留正文/他图，失败只插回本次条目，保留并发变更。Risu 删图按最终 CBS trace 与宏结构定位当前可见引用，同时改已翻译消息的 original_content 对应宏地址；保留条件分支、共享变量、译文与其他文本，不重新求值随机/变量/时间。来源无法对应、循环多次展开或纯显示脚本重建无原引用时明确拒绝；非内嵌视图屏属于不可交互背景。归属变化或取消均不写入。

导入远程主头像/独立背景必须为可识别且可解码的 PNG/JPEG/WebP/GIF，下载、内容或一般网络失败拒绝主卡提交；保留源待用户重新确认重试。附属素材可延迟重试。PNG 容器图只存一份头像，展示派生背景不复制 Blob；独立背景优先，用户手动清除后不再派生。

## 7. 流式草稿 checkpoint

草稿在 app_meta 的 stream_draft_v1 键存完整未提交原文，绑定角色/会话/目标模式/seq/hash；不占正式 seq，不进正式消息、记忆、世界书、用量、翻译或 API，不恢复连接。限额/节流/校验查 [64-stream-drafts.js](../app/src/main/assets/js/app/64-stream-drafts.js)。

- 限额只阻止新建保护记录，提示后生成照常；读不出的记录原样保留，明确确认“清除”后才按键删除。后台落盘失败不能向原生报告可暂停，前台提示原因。删角色/会话与所属草稿同事务。
- 一次生成只写自己 epoch 认领的草稿，基础被宿主改动不把在途草稿提前作废。正式提交冻结并排空 checkpoint，消息/候选与删除草稿同事务，以 sourceDraftId 或 seq/hash 防重复；失败可重试，后台写入不能复活已提交草稿。
- 启动先删已提交/确已无所属角色会话的草稿，再按各自目标自动保存；不依据旧失效原因判断归属。基础变化且对应回复仍在时，追加末尾未显示候选，保留当前内容、候选、翻译与派生，未完成仅属于该候选；续写接对应回复当前原文，无对应回复才新建。过期或数量清理在自动保存后进行，失败草稿不删除也不计上限，恢复卡提示自动保存失败的原因；基础未变的过期草稿不因期限删除。
- 丢弃先作废排队写入、等待在途完成再删记录/索引，失败恢复并提示，不能留下继续写入的孤儿。中断正文正式保存后成为带未完成标记的普通助手消息，可手动续写。只读恢复期另受 [§3](#3-持久化三态与恢复) 约束。

## 8. 导入与未知字段

只提供外界角色卡（JSON/PNG/CHARX）、世界书、预设、转盘方案、Quick Reply 和 Data Bank 附件导入；**不提供整库还原或聊天导入**。解析/校验后用户确认并一次提交，读取能力取决于设备实际资源，不设置人为业务大小门槛；失败报真实原因且不留半成品。格式优先级与容器算法查 [30-card-import.js](../app/src/main/assets/js/app/30-card-import.js)、[52-worldbook-import.js](../app/src/main/assets/js/app/52-worldbook-import.js)。

CHARX/EPUB 共用 [charx.js](../app/src/main/assets/js/core/charx.js) 容器边界：支持 Store/Deflate 与 ZIP64；拒绝加密、分卷、其他压缩方法、未标 UTF-8 的非 ASCII 文件名、非法 UTF-8，以及目录/长度/CRC 损坏。空路径或真正上溯出根的条目跳过，不影响其他合法条目；`..notes.txt` 这样的文件名保留。文件名须按 UTF-8 重新打包，不猜测其他编码；解压按实际输出积累，不按不可信声明预分配。

主数据/选定主图读取失败拒绝；非必要附属素材失败保留声明并列明名称。CHARX 缺/非图片 icon 用默认头像并提示，坏 module 在预览前拒绝；未知扩展不导致标准卡整卡拒绝。PNG 双块以 ccv3 为准，不能挑任意块下结论；无内嵌字节的 risustored URI 不远程获取。取消导入下载不得继续提交。

CHARX 或 `extensions.risuai` 卡归 Risu，其余归 ST，无手动切换/旧卡迁移。模块完整保存，官方优先级仅在运行副本选择 regex/trigger/世界书，不改卡 JSON 原文。Risu 范围见 [兼容矩阵](COMPATIBILITY_MATRIX.md#5-risu-卡片运行体系)。

Risu 的唯一会话 owner 是 `session.risu`：聊天变量、聊天局部 global/toggle、作者注、localLore、inlays 与 viewScreenImage；global 不与 ST 全局共享，viewScreenImage 替换不累积旧图也不动 inlay。Trigger 世界书写角色 risuLorebookState，Lua upsert 写会话 localLore，背景写角色当前字段，原卡/模块留作证据；不新增 Store 或迁移。持久 Lua 数据用 chat 变量/getState/setState，Worker/Lua globals/演出状态只驻内存。

Risu 原文 content 保留，`message.risu.{source,text,template}` 只在 source 与 content 一致时有效：运行文本与动态宏来源分开；未改宏保留来源、普通文字改写只映射当前分支、明确替换宏输出保留脚本结果，不猜测旧展开内容对应的变量。新写/编辑/续写只执行 pendingMacroEffects 标记的新部分，重读/显示/Prompt/重启不重复写宏；主动脚本依权限执行，流式预览/提交前预热不写数据。显式脚本 cut/insert/modify 按语义写入，旧历史变动失效记忆/合并，单纯动态重读不失效。

同会话 Risu 执行串行化，开始/排队都可取消；最终 owner 校验后的同步应用为提交点，进入原子仓储保存后允许完成。结果绑定捕获角色/会话/消息修订，失败只撤销所属字段并保留并发数据及身份；切换释放离开会话运行时，已捕获的后台生成保留到结束。变量缺失与空串/字符串 null 区分，临时 display/request 值不落盘、不跨调用。实现入口见 [33-risu-execution.js](../app/src/main/assets/js/app/33-risu-execution.js)、[risu-history.js](../app/src/main/assets/js/core/risu-history.js)。

AI 汉化只增中文显示名/别名，不覆盖正文、原关键词、规则、rawCard 或 _raw，重复导入不累积别名；批次完整审计通过才提交，最多三次，任一字段失败整批放弃。已有中文、标识串、宏/正则等不需要中文形式的内容跳过；常驻与 Risu 条目不生成关键词别名或把关键词送模型（含上下文），只汉化分类/显示名，因它们不消费夜欲别名。审计、请求与待补全计数共用判定，不看旧状态标记；中文 nickname 直接作显示名。具体判定查导入/汉化实现。

替换角色只就地更新其拥有的随卡书：按完整原始书名配对，再核对汉化名/导入前名，明确不同原名不配对、不剥数字后缀；旧源路径可取旧书名但不能按新位置配对。无 owner 且只绑定本角色的旧分类可配对并补 owner，共享/他人分类不更新。只替换 character_card 来源条目，用户条目/id 保留排后；不匹配新建，新卡空 character_book 不清旧书，替换数量向用户披露。独立世界书原文件留 sourceMeta.raw；角色入口拒绝非卡 JSON，并指向正确导入页，数组逐项校验。

## 9. 临时工作区边界

文风检查在途状态、导入预览/选择/工作副本、依赖报告、函数/控制器/缓存均只驻内存；完整校验才提交。依赖报告从原卡与明确结构确定性重建，不写数据库第二份报告。

componentImportMode 仅 full/basic：两者都保留全部原始材料；basic 只分别关闭角色正则与脚本，不删正文、素材、世界书或扩展；导入选择与当前开关分开，EJS 例外见 [§2.1](#21-角色人格与世界书)。bundle/Zod 互斥，TypeScript 窄化只改执行副本，不改原脚本；禁用 initvar 条目仍供变量初值而不普通注入。

报告不把空容器或无可执行证据的未知纯数据当依赖；运行时会加载的远程模块/网页按启用报告，已关闭脚本的模块归“支持但关闭”，不重复列缺失。未知宏原样保留，不阻止正则；仅无效语法/无对象/无环节才列“不执行”。按卡片完整写法展示，官方宏按名字判断；明确写在启用脚本中的宏标为随卡自处理，文本扫描不冒充语义分析。具体扫描口径查 [31-card-dependencies.js](../app/src/main/assets/js/app/31-card-dependencies.js)。

## 10. 维护基线

稳定基线身份见[版本身份](RELEASE_CHECKLIST.md#版本身份)；它也是唯一支持的应用数据升级起点，不登记更早数据迁移。新数据库只建 §1 八 Store，历史 Store 不读/不扫，也不因整理物理删除或升 schema。已知退役字段加载规范化移除，正常保存不再写，启动不为清理单独保存。

新字段优先可选并有安全缺省，重复规范化稳定。派生数据可重建，原始主数据不可借此删除；改变 schema 或 memory 外部格式属于档 C 改动，须事先明确基线、目标与验收差异。
