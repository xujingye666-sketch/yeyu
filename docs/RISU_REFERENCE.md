# Risu 卡参考与取证

本页固定复现身份、证据边界、未接项和上游特殊语义；完整已支持名称与实现参数以 capabilities 及测试为准，持久化只引用[数据模型](DATA_MODEL.md)。

## `module.risum` 固定参考

只读参考为 [RisuAI](https://github.com/kwaroran/RisuAI) 的本地检出（下称 `<对照目录>`），tag `v2026.10.211`，提交 `02a83695d81eb4e083453c4524b8c7d463df95aa`；不得为对照更新或修改它。容器来源为 `src/ts/process/modules.ts` 的 exportModuleLegacy/readModule，字节替换来源为 `src/ts/rpack/rpack_js.js` 和 rpack_map.bin。

本地解码器为 `core/risu-module.js`，只解码不执行；容器字段和 API 返回形状直接读实现。需特别保留的上游边界：资产载荷按索引对应 module.assets 三元组 `[名称,持久化引用,类型]`，官方允许元数据多于载荷，多出项保留但无字节；结束标记后的数据不属模块。浏览器用经典脚本映射，不 fetch file URL。

512 字节互逆映射 SHA-256 为 `428e939c41617140ef2fad0420d9163cc80ce7c9b2f5e620223a25acc8afd498`。解码器按格式重写，未复制 rpack_js.js；上游说明 RPack.js 在 RisuAI 外适用 AGPL-3.0，许可证登记见[发行依赖](FRONTEND_MODULES.md#本地发行依赖)。

## 参考原卡固定身份

取证样本以原文件 SHA-256 为准，不因文件改名推断身份：

| 原卡 | SHA-256 |
| --- | --- |
| Vi & Caitlyn with Jinx | `42339b9a6aaf155387c721b40e70d141834c16eb2c8b830d272bfe5478c5bf92` |
| Adelheid Hitler | `1942ed801835be736750cf55ac711d4f57ebac02ae63e4990128f756faf93851` |
| 허접허접 동위체♡ | `52ccda13a882c3ad667a00070d104a546b2df507ac8bdcb6d5e0aa55bfd22c8e` |
| RisuAI-Iirena Koran | `5adfae0913a17bfdd72cb23214eca06999704df4ea4a40e57ab9ae8cb915050b` |
| RisuAI-Sign here hero | `65f8407ac2707545b7c4e6089bee0e14a83083eac9545d40347655846a1d8694` |

## 取证与复测入口

以下探针按需运行、不进门禁，只读固定参考及原卡；结果仅输出结构、计数、长度和哈希，不输出卡片、世界书或脚本正文。导入与显示探针须在命令中显式提供原卡路径，不设默认样本或环境变量回退；未传路径、原卡缺失或不是文件时，提示用法并失败。上表保留历史取证身份，不保证本机存在原卡；模块对照仍须显式提供两张原 CHARX，不能用 PNG 样本代替模块验证。

| 探针 | 触发与命令 |
| --- | --- |
| `risu_reference.js` | 改解码器/映射或核对模块时：`node tools/probes/risu_reference.js <对照目录> <Vi 的 charx> <Adelheid 的 charx>`。必须按序恰好两张同时含 card.json/module.risum 的 CHARX；比较官方映射、独立读取器与本地解码器的 JSON、资产字节、容器结束位置及 CHARX 长度/CRC。 |
| `risu_card_import.js` | 改导入、持久化、媒体或体系归属时：`node tools/probes/risu_card_import.js [--generation [--lore-regex-probe]] <原卡路径> [原卡路径...]`。真实文件选择/确认/导入及重载；generation 核对出站 CBS、回复修复、原文和重载 pick。 |
| `risu_display_browser.js` | 改显示链、选项、情绪舞台或背景时：`node tools/probes/risu_display_browser.js <原卡路径> [原卡路径...]`。核对显示、原卡正则、隔离帧、选项分支、手动触发与重载；截图只在 `.tmp/risu-display/` 供人工查看。 |

后两项用本机 Edge、450×974 无头视口，阻断非本地资源、固定 SSE 回复、自动接受导入，只证明桌面导入/显示，不能替代真实模型、Android 或门禁。

`--generation --lore-regex-probe` 在真实卡隔离副本追加十条非常驻世界书，保留原卡内容，经预设预览与 regenerateLast 比较实际出站：before_desc/after_desc、同位置顺序、预设重组后 depth=0 三角色顺序、main/globalNote 各注入一次，以及预览前后主数据不变、恢复后的持久内容。含未命中和关闭正则对照、禁止递归来源匹配，尾部保留原卡 depth=0 条目。结果须区分原卡自带能力和合成组合，不能说原卡本就使用该能力。主请求以合成用户输入定位，情绪等辅助请求另计；有脚本的未变消息按显示缓存，无脚本 CBS 按当前消息数，重载独立核对上下文。

能力名称以 `core/risu-cbs.js` / `core/risu-trigger.js` 的 capabilities 及 Lua 安装清单为准；真实应用验证入口为 `tools/tests/risu_runtime_browser.js`、`risu_execution_browser.js`、`risu_lorebook_browser.js`，固定上游取证沿上述探针执行。官方目录无 node_modules，未运行完整 Vitest；局部函数/源码取证不能称为官方整站差分。历史 v0551 VM 仅辅助佐证分支顺序，不作当前版本证据。

## 两张真实卡的模块清单

完整模块名称、字段、逐条正则和资产计数由 `risu_reference.js` 从固定原卡重建，不在文档另存一份清单。其独立官方读取器逐项比较模块 JSON、资产、结束位置；资产清单哈希按声明索引、规范 ZIP 路径和内容 SHA-256 顺序计算，并校验长度/CRC。

取证中容易误判的结论：Vi 与 Adelheid 的 module 都没有内置资产，raw 宏实际引用同 CHARX 的 x-risu-asset；动态 raw 必须运行时按捕获组解析。两卡没有 mcp.url、模块 namespace、module 宏或扩展 modules，未发现卡外全局模块/插件依赖；Vi 的 fonts.cdnfonts.com、Adelheid 的 fonts.googleapis.com 是 HTML/CSS 网络字体，不是插件。`ableFlag=false` 只是采用默认 `g`，不是禁用；`disabled` 类型才不执行。

## CBS 核心与宿主集成

精确名称以 `YeyuRisuCBS.capabilities` 为准，hostContextMacros 不代表卡外服务存在。资产 `raw` 是 path 别名，`#func/call/#code` 是 parser 结构，不重复统计主名称。CBS 在可终止 Worker 中求值，不执行任意 JS/DOM/网络；不额外设操作数、展开数或深度门槛，失控计算用超时/取消终止，保留官方累计 20 次调用限制。

| 固定参考的坑 | 维护约定 |
| --- | --- |
| 缺宿主/未知宏 | 保留原文并 onError，strict 抛带 code 错误；显示未命中资产宏省略，Prompt 延后。图片宏/图片标签不可用时用缺失媒体占位；裸 raw/path/source、bg/bgm/audio/video 仍省略。position 为 doc-only，`__` 返回空串。 |
| 宏边界 | parser.svelte.ts 的栈只配对双花括号，单双引号不形成字符串状态，因此 JSON/字符串内连续 `}}` 也结束宏；不能改用 JS 字符串解析器。根层未配对 `{{` 留原文，之后宏仍求值；块内差异见后表。 |
| user/char/bot 占位 | 每次解析含 call 重入和宿主文本都先不分大小写改成宏，pure 块也如此；仅改求值副本，偏移须映射原文。 |
| 函数与 code | arg::0 是函数名，实际参数从 1；含入口在内累计调用超过 20 返回官方错误。只有精确 #code 开块，先 CBS 再去真实换行/制表并解转义，不执行代码。 |
| 数学与条件 | calc/问号表达式保留官方 RPN 左结合乘方、逻辑返操作数、缺操作数/非有限数边界；不要按 JS 算术直觉修正。假 #when 仍运行内联 matcher 并按原顺序处理 body/else，假 #if 不执行 body；以固定上游 parser 路径取证为准。 |
| 注释 | `{{// note}}`、`{{//::note}}` 都不是条件结束标签；固定官方仅 doc-only，先求内部宏再保留注释文本，Prompt/显示无统一剥除，不可顺手删除。 |
| pick | 固定 pickHashRand/sfc32；本地种子为持久角色 id＋session id，推进为普通消息数 mod 1000，开场不计。显示位置/裁剪不改种子，同身份和消息数下重绘/重载一致；增加消息可变，相差 1000 重复。不新增缓存。random/randint 不固定。 |
| 转义与别名 | 转义使用 U+E9B8–U+E9BF 占位到最外层还原，防止嵌套时当分隔符；`:each` 是 doc-only，只有 #each 开循环，前者保留求值嵌套后的文本、不报未知宏。 |

历史宏来源映射用 `core/risu-history.js` 与已有 jsdiff，避免再造差异算法；写入与 runVar/rmVar 归[数据模型](DATA_MODEL.md#8-导入与未知字段)，普通 Prompt/重绘不得重复已提交变量副作用。开场对应独立 firstMessage，chatIndex 为 -1，普通宏消息序列排除 opening。

## Token 估算与不支持项

getTokens/Tokenize 的唯一规则见后表。情绪分类复用聊天路由，不新增 tokenizer 或模型资产；固定官方还以精确 token ID 为标签加 logit_bias 并按最近约五次选择降权，夜欲不发送这份 bias。

## 脚本、触发器与 Lua 宿主

源码参考以固定 `scripts.ts`（flags/actions/顺序）、`triggers.ts`（事件/条件/effect/权限）、`scriptings.ts`（Lua hook）、`command.ts` 和 `process/index.svelte.ts` 为准；本地调用链读 `33-risu-execution.js`，不在文档复制逐函数实现。以下边界不可因整理或重构改变：

- Risu Regex/CBS/世界书匹配用独立可终止 Worker，不借 ST Regex，不在主线程执行世界书正则。语法错报告后继续下一脚本；超时/取消终止 Worker。批量行失败只撤销该行，后续显示可继续；发送首个失败仍让整次发送失败。
- Trigger 普通递归上限 10，低级权限保留官方例外，不另加效果总数/深度门槛；长循环让出并检查停止。V1 比较采用先通过再反向判否，非数值（含字符串 null）成立，未知 operator 也通过并诊断；V2 正向比较不受影响。未知 effect/缺宿主明确失败。
- Risu command 独立于 STScript。保留 `/cut` 的 splice 返回行、`/del N` 保留末 N 行；`/setinput` 已接真实输入框（官方为占位）。multisend 同事务按序等待完整生成，clear 每次清事务消息；失败/停止/owner 变化整体不提交。test_lorebook 必须实际激活，不能给伪结果。
- Lua 在 Wasmoon Worker 真运行，无 DOM 或主线程回退。计算保护只算 Worker 活动时间，资源/排队/已让出事件循环的 RPC 不算；取消终止 Worker 与宿主请求，迟到结果不得续接。cbs 默认 runVar=false。同 mode/code 可复用引擎，跨 hook 持久状态归聊天变量。
- editprocess 只跑正则、不跑 Lua，Lua editRequest 消费完整消息数组。流式不重复输出副作用，最终按官方 strong 模式处理；显示顺序为 Lua editDisplay → display trigger → CBS/Regex。流式显示只读，变量/情绪/刷新不离开求值。ImgGen 顺序见后表。
- CHARX 模块按上游替代角色脚本列表、采用卡片 lowLevelAccess，不是卡外模块。Lua edit hook 始终低权限；editDisplay 可写聊天变量，不可改消息/角色或调用低级网络/模型。
- output/manual 的 sendAIprompt 不设本轮追加次数门槛，由停止按钮终止后续调用。GUI/reload 在提交后刷新，不复刻执行中间态即时绘制。
- 世界书 global 来源优先 module.lorebook，否则 character_book；global 改动写角色覆盖、local 写会话。激活顺序 global→local，Lua 查询 local→global。保存规则归数据模型，不另开写盘入口。
- 世界书 regex 关键词按 `/pattern/flags` 解析，flags 可空；先编译全部关键词，任一无效则本次匹配为否，每条消息匹配前重置 lastIndex。keep/dont_activate_after_match 标志只作用所属条目，不跨条目串用。
- depth=0 非 assistant 世界书在普通预设条目后保留激活顺序，再追加 assistant prefill；尾书不参与续写目标识别。inject_at main/globalNote 在角色卡覆盖后作用该槽，禁用槽不发送；预算用同一变换，不重跑脚本/写变量。
- convertCharbook 保留主次键空白/空项，secondkey 不取决于 selective，name 空值合并；不把 CCv3 id/uid 注入 Risu 条目。原生 id 保留类型、child 严格相等，标志键为 id 或内容哈希；keep/dont_activate 同轮可读，最终随事务提交。matchLog 保留官方控制字符前缀。
- 装饰器按锁定 `@risuai/ccardlib 0.4.2` 重写，名称不限制字符/大小写，逗号参数去空项、空行终止、end/fallback 沿官方；未引入依赖，npm 原包 SHA-256 `07045b202af1cbb9b49f2fd4f99ca02b9c9697bd340da8330969c6dc92582562`。

显示边界与已知坑：

- 情绪 CharEmotion 等价状态只驻所属会话显示内存，分类/Regex/Trigger 都不持久化；初次/重载仅找名称精确 neutral，没有就无舞台，转 ST 立即移除。非内嵌 emotion 分类只用真实资产名、官方提示/few-shot/30 token 上限，按精确→包含→neutral 选；不按正文关键词猜。成功应用 emo 才跳过分类，连续生成只分类最终回复，停止/切换/目标变化作废结果。
- 素材先建引用索引再按需读，不能等整张大卡水合；未读 URL 保持 undefined，不能空串吞掉首次显示宏。CBS 显示与显示脚本始终不拿素材 URL，输出不因水合时机改变，才能保留展开/输入状态；搜索正文去素材宏。
- backgroundHTML 先用当前角色/会话 CBS，不带 role（得到 null）、runVar=false，只在选中分支解析素材；背景显示不能写变量。
- 含 HTML 的卡片正文在无脚本 iframe，背景正文独立帧；共享 CSS 按背景→当前可见消息 DOM 顺序，仅同角色/会话，提供者离开即撤销。样式变化原位更新，不重载正文帧；主题从气泡继承但卡片显式样式优先。details/表单按消息逻辑身份恢复，混合消息的夜欲面板/目标仍归原宿主。
- DOMPurify 必需，失败显示转义文本、恢复可重挂。style 仅保留 CSS 重建边界，CSP 限获准 HTTPS/媒体且禁脚本；帧不能导航/操作父页，HTTP(S) 点击转系统浏览器，Risu 按钮/trigger 优先。不能因保留 CSS 而绕过 HTML 净化。高度计入根节点顶部与折叠 margin，收起必须同步缩短。
- Risu 表单保留 form/risu-form，所有提交先阻止导航；带 risu-form 时按 FormData（含提交按钮，同名字段合为数组）调用 Lua onFormSubmit(accessKey, triggerKey, metaJson)，metaJson 为 `{data: 表单字段}`。角色 triggerscript 与内嵌模块 trigger 按序运行并沿现有事务保存；不建立卡外模块管理器，也不接 ST/TavernHelper 表单。
- appendMessageDom/reloadChat/renderChat 复用缓存，v2UpdateGUI/reloadDisplay 提交后清缓存；真正重载重新求值，不把生成样式写入消息。一轮显示按序合并事务，失败单条撤销/保留画面/下次重算，其余继续；显示写变量只保存一次，不因此再算自身/先前结果。写会话事务先取消该会话待执行/执行中的显示事务。

本地 risu-logo.png 来自固定 `public/logo_512.png` 原字节，SHA-256 `9d77e1651beb706940d97c5a1896e2a0d8e74d0049636d521a10c4cc857ac827`；不要用重绘近似图替换品牌宏资产。

### 未接项与上游差异

| 未接或差异 | 真实行为与理由 |
| --- | --- |
| getTokens / Tokenize | 不引入精确分词器或模型资产。Lua getTokens 保持异步接口，用 YeyuPure.estTokens 字符估算，与世界书/Prompt/裁剪一致；Tokenize/v2Tokenize 要真实 token ID，明确不支持，不用字符序号冒充。 |
| axmodel、submodel/axLLM | 无独立辅助模型配置，明确失败/诊断；主模型多模态另有真实能力。jbtoggled 无 jailbreak 配置为 0。 |
| metadata 模型映射 | 读取 chat 实际路由，三名称键用 API 模型标识；普通兼容路由用固定未知模型 `OpenAICompatible/AsIs/Unknown=0/4/0`。仅官方 api.deepseek.com 四模型精确匹配：chat/reasoner 为 0/12/13，v4-pro/v4-flash 为 0/12/14，代理不凭模型名猜。编号不等于已装 tokenizer；mobile 按官方 UA，local/node 专指 Tauri/Node，均 0，risutype=web、version=2026.10.211。 |
| mainPrompt/jailbreak/globalNote | 无卡外 Risu preset/plugin 来源时为空，不能据此声称支持配置；authorNote 取会话并回退全局。 |
| 相似搜索 | 无等价现成宿主；embedding 依赖卡外配置且排序不同。需卡外服务时另行决定。 |
| 卡外 module/plugin | 无全局模块管理器，moduleenabled/moduleassetlist 按无已启用模块；CHARX 内嵌 module 已展开为角色内容，不能混淆。 |
| triggercode | 固定官方有类型但无执行分支，本地同样不执行任意 JS。 |
| 旧 `{#if 条件 内容#}` | 官方仍支持 deprecated 语法，夜欲不实现、原样输出；上游把 `{#` 也算开栈，含此语法的双花括号配对可能不同。 |
| 块内未配对 `{{` | 夜欲保留原文、后续结束标签照常关闭；上游导致块不闭合，末尾以 `<` 加已求值块体拼回、块头丢失，此怪癖不复制。 |
| 语音/TTS/VITS | 固定上游 `process/command.ts` 的 `/speak` 接夜欲当前角色云端声音（包括 V1/V2 触发器调用命令）；卡内 VITS 模型保真但不播放，默认空 vits 不是实际依赖。 |
| 演出 toggle | 上游默认数据库全局（只有 locally 模式改聊天），夜欲只属会话。新建/清空/newchat 从当前会话只继承 toggle_；分支/检查点复制全部 Risu 状态，导入不继承，保存规则见[消息会话](DATA_MODEL.md#4-消息会话与派生显示)。两边无默认初始化，未设置读的是字符串 null，所以 tis::键::null 成立、tis::N 不成立；初次全由这些条件构成的开场可为空。 |
| 世界书 tokenBudget 0/缺省 | 夜欲不限，上游全部丢弃；0 在上游无实际用途且让整书静默失效，故有意不同。取值规则见[设置](DATA_MODEL.md#23-设置与任务路由)。 |

卡片出图的差异集中在以下边界，适用于 ImgGen、runImgGen/v2ImgGen、Lua generateImage 和 viewScreen=imggen：

- 上游各 SD 设置换成夜欲当前图片来源，一次一张；negative 不发，与上游 OpenAI 兼容一致，去敏感化来源先改写。原图不缩到 1024²/转 PNG；多标签串行，上游并发。
- inlay 属会话，清空/删会话回收（上游全局常驻不回收）。非内嵌视图按卡片 newGenData.instructions 整理最近用户至本次回复，以 prompt 的 slot 生成并复用舞台；当前图按会话保存、替换回收无引用旧图（上游 CharEmotion 仅内存）。
- 非流式在 editoutput 后、output trigger 前处理标签，随消息事务提交/撤销；完整流式在 output trigger 后处理，占位期间停止保留已提交回复/已出图并清余标签。嵌套也按实际响应类型排序，但全部结果随外层事务提交/取消；被停止或不完整的主回复不启动出图。
- 只读显示出图返失败值、预览不出图。inlayeddata 与用户 inlay 不转多模态 part/图片说明（上游会转），普通/嵌套请求都清非系统消息 token；Lua 主模型显式头像 token 读取实际媒体转 part 是另一入口，不可混同。
