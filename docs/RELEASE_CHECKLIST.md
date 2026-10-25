# 发布检查清单

本页是改动分档、验证、构建和发布操作的唯一入口。产品边界见[架构说明 §9](ARCHITECTURE.md#9-产品边界)；清单本身不授予候选、tag 或发布权限。

## 改动档位

| 档位 | 范围 | 验证与交付 |
| --- | --- | --- |
| A — 不进 APK | 文档、测试、门禁和构建配置 | 运行 Fast；不改版本、不构建 APK、不建 tag |
| B — 常规 APK 改动 | 界面、文案、交互和未触及档 C 的局部逻辑 | 实现完成后运行 Fast；制作候选时按[版本身份](#版本身份)设定版本并运行 Release |
| C — 高风险改动 | IndexedDB schema、memory 外部格式、数据迁移、受保护 Prompt、包名、签名、发布身份或原生桥边界 | 在 B 的验证基础上，候选前额外做一次独立只读审查；产品边界不因档位放宽 |

## 验证入口

门禁只有 Fast 与 Release，只运行确定性测试；执行步骤以 [run_project_checks.ps1](../tools/qa/run_project_checks.ps1) 为准，测试及功能域以 [test_manifest.json](../tools/tests/test_manifest.json) 为准，不另维护步骤清单副本。

环境要求：Windows、PowerShell 7、Git、Python、Node.js 和 Microsoft Edge；Node 版本及静态检查依赖以 [package.json](../package.json) 为准，首次准备或锁文件变化后运行 `npm ci`，门禁不自动安装依赖。浏览器测试使用 `package.json` 固定版本的 Playwright 驱动本机 Edge，不另下载浏览器；Edge 查找规则以 [source.js](../tools/tests/source.js) 为准，可用 `YEYU_EDGE_PATH` 指定。缺少运行时会直接失败，跑基础集也需要浏览器环境。

Fast 与 Release 均运行 `npm run lint`，检查范围和全局符号来源见 [eslint.config.js](../eslint.config.js) 与 [classic_globals.js](../tools/qa/classic_globals.js)。按需 vendor 在消费文件用 `/* global */` 声明；测试挂到 window/globalThis 的夹具名在文件头用带来源的同类声明。经典脚本符号表现场生成，不提交；静态检查不区分 Node 外层与浏览器回调，跨环境误用由运行测试验证。[加载约束](ARCHITECTURE.md#31-加载与启动)另见架构说明。`npm run format:check` 只供人工检查，不属于门禁；配置见 [.prettierrc](../.prettierrc) 与 [.prettierignore](../.prettierignore)。

### Fast 与功能域选测

实现完成后运行 Fast，默认按相对最新正式 annotated tag（见[版本身份](#版本身份)）的已跟踪差异及未跟踪文件选测（遵循 Git 忽略规则）；没有正式 tag 时明确报错，可用 `-BaselineRef` 显式指定比较基线（例如刚克隆的仓库用 `-BaselineRef HEAD`）。只计 `app/`、`tools/`（不含 `tools/probes/`）、`gradle/` 与根目录构建配置，文档和探针改动不触发选测（见 [quality_gate_contract.ps1](../tools/qa/quality_gate_contract.ps1)）；`-BaseOnly` 只在明确只核基础集时使用。

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/qa/run_project_checks.ps1 -Gate Fast
```

[test_manifest.json](../tools/tests/test_manifest.json) 是永久测试及功能域的唯一登记。每个测试用 `domain` 归属一个功能域、`keep` 标明保留类别，`gate: "fast"` 的测试组成 Fast 基础集；`profiles` 只提供运行环境、超时和并行调度参数。`domains.paths` 使用目录前缀或 `*` 匹配领域源码，`related` 包含跨域消费者；源文件新增、移动或删除不需要逐条修改测试依赖。

- Fast 运行基础集加改动所属及相关功能域；修改测试文件直接选择该项，删掉的测试不再调度；修改登记表选择门禁工具域以验证选测行为。
- 共享底层 `sharedPaths` 或未归类的改动运行全部永久测试，后者在输出 `fallbackChangedPaths` 中列出；若反复出现同类新模块，只需补一次域匹配。门禁工具和通用夹具改动也运行全体，验证调度及夹具消费者。
- 本次新增或改动的测试文件共运行三次，任一次失败即判失败（`stabilityCheckedTests`），偶发失败在登记前暴露。
- 改动触及探针所验证的范围时，汇总的 `triggeredProbes` 列出探针及触发原因，触发条件登记在清单的 `probes`；验证结论须报告这些探针的结果，未运行须写明原因。

调度器会在每项测试完成时输出结果。只查看选测范围时，显式传入改动路径；多个路径用逗号分隔写成一个参数（`--changed a.js,b.js`），空格分隔会被当成多余位置参数而直接报 `invalid argument`。`--list` 不执行测试，也不代表门禁通过。

```powershell
node tools/tests/run_all.js --gate Fast --changed app/src/main/assets/js/app/50-worldbook.js --list
```

`-TestScript` 可补充清单中已登记的测试文件名、路径或 ID；补充项与原选集去重后共用调度、超时和结果汇总，不缩小 Fast 基础集或 Release 全集。Node 入口对应 `--test`。

### Release

完整回归由候选 Release 一次承担：始终运行全部永久测试并保留构建及 APK 核验。Release 不带选择器，`-SourceCommit` 必须等于执行时当前 clean HEAD 的完整 40 位提交号：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/qa/run_project_checks.ps1 -Gate Release -SourceCommit <完整40位commit>
```

### 测试写法

按用户实际使用的场景启动真实应用并逐个验证，报告看到的结果；只读代码、跑单元测试或使用替身不算实际验证。开发中运行与改动相关的测试，完成时按 Fast 选测，候选前按 Release 完整回归；共享底层改动触发全体测试的规则见[上方选测说明](#fast-与功能域选测)。永久测试的新增与维护见[下方准入规则](#永久测试与一次性验证)，审查不因测试写法单独退回。

现有 [source.js](../tools/tests/source.js) 浏览器包装默认使用手机触控与移动视口，未捕获页面异常和未处理的 Promise 拒绝会使测试失败；显式环境参数和 `expectPageError` 可声明测试所需环境及预期异常。这是现有运行机制，不增加测试准入条件。[app-ready.js](../tools/tests/helpers/app-ready.js) 等待应用数据和草稿恢复完成；[stream-page.js](../tools/tests/helpers/stream-page.js) 提供整页场景与脚本化网络响应。

### 按需探针

真实角色卡包、大资产、真实远程网络和平台环境的验证放在 `tools/probes/`，不进门禁，作为受影响流程的专项证据单独报告。UI 主视觉验收按 [VISUAL_ACCEPTANCE.md](VISUAL_ACCEPTANCE.md)，其所用截图探针也登记在该页；Risu 与 ST 的固定上游复现入口分别见 [Risu 参考](RISU_REFERENCE.md#取证与复测入口)和 [ST 参考](SILLYTAVERN_REFERENCE.md#语义复现入口)。

| 探针（位于 `tools/probes/`） | 用途与执行边界 |
| --- | --- |
| `run_android_emulator_smoke.ps1` | 改动涉及 Worker、CSP、原生桥、文件系统或 Android 生命周期时触发平台冒烟；先关闭同名 AVD，再无窗口冷启动。`-Apk <路径>` 使用已有 APK 原字节，否则 Debug 构建；`-NativeLifecycle` 在真实 Activity/WebView 上补测导航、系统文件选择/连续取消、返回、后台恢复、选择器未关闭时的 renderer 恢复、连续崩溃保护与重载后的 IME/数据，相关原生路径改动时启用。该扩展临时关闭 AVD 的缓存进程冻结以便 CDP 观察，结束时恢复；图片夹具走 adb reverse。用 `-AvdName` 指定隔离测试 AVD（API 35、390×844 override，本探针使用 Chrome 与 DocumentsUI）；Debug 与原证书包不可混装。日志在 `.tmp/android-emulator-smoke/`，报告区分进程退出、启动超时和探针异常 |
| `stream_display_backpressure_real_model.js` | 真实卡与模型的流式压力测量；`--fake` 仅本地 SSE，`--preload` 使用合成历史。报告 CPU 降速、预载条数、就绪等待及是否超时，不把合成/本地结果当成真实模型效果；参数和计数由脚本定义 |
| `risu_conditional_translation.js` | 真实应用导入后的开场白翻译、选项切换、保存回读和恢复原文；用 `--card <原卡路径>` 选样本，`--offline` 仅替换模型响应。报告条件块数、字符/标记计数与未改写区间比对，不把无条件块样本当作条件翻译验证，不输出卡片、回复或凭据 |
| `chat_render_measure.js` | [长聊天测量说明](CHAT_RENDER_MEASUREMENT.md) 是运行、就绪、数据守卫与计时口径的唯一说明；真机执行须设备已连线、主人在场并同意 |

### 真实卡选测

涉及下列流程时，从可用原卡中选择具有相应能力的代表样本，沿实际使用入口验证；无关改动不全包重跑。不保留固定卡包，探针须由命令显式提供卡包目录或原卡路径，不读取环境变量中的样本目录；缺少样本时给出用法并失败，不静默跳过。需要真卡而没有样本时，报告该项未验证，不据此放宽验收。ST 与 Risu 样本按各自已支持的能力判断，导入保真不代表私有运行时已适配。

| 改动影响 | 样本与验证终点 |
| --- | --- |
| 导入、持久化 | 选择覆盖所改格式、素材或未知字段的原卡；完成预览、确认和重载；预设导出改动另按 [预设数据模型](DATA_MODEL.md#214-聊天补全预设) 核对凭据移除与未知字段保留 |
| Prompt、预设、世界书、生成 | 组合相关原卡、预设与世界书，从发送入口核对实际请求内容、回复显示和重载；涉及模型遵循度或输出解析时使用真实模型 |
| 脚本、变量、事件、卡片前端 | 选择实际使用该能力的原卡，验证启动、交互及角色/会话切换；涉及生成事件时覆盖一次发送 |
| 立绘与媒体 | 选择含相关素材的原卡，验证显示、切换和重载；视觉边界按真机视觉验收执行 |

卡包导入与重载入口为 `node tools/probes/card_package_browser_acceptance.js --package <目录>`（简写 `-p <目录>`），相对文件布局见脚本的 `samples`。也可同时提供 `--card <路径> --worldbook <路径> --preset <路径>` 选择组合；这些文件参数可覆盖卡包中的对应样本，显式选卡时只验证所选原卡。加 `--generation` 验证请求组装、固定本地响应的显示与重载。模型响应替代、关闭辅助请求或调整预算等测试条件须随结果报告，不推定为真实模型效果。脚本、模型和素材专项使用 `tools/probes/` 中对应能力的现有探针。`--generation --ejs-probe` 在导入的真实卡描述和本地模拟回复上附加最小 EJS，断言 Lodash 占位符在请求与显示求值中保持身份；不修改原卡文件，报告须区分这种组合探针与原卡自带 EJS。

Risu 世界书聊天正则的真实卡预览/实发专项入口为 `risu_card_import.js --generation --lore-regex-probe`，样本、隔离副本、位置与顺序、未命中及固定上游语义边界见 [Risu 取证入口](RISU_REFERENCE.md#取证与复测入口)。

结果记录样本文件名/哈希、所测源码、实际完成的流程、模型与设备边界；原卡、Prompt、回复正文和凭据不进入仓库或日志。真实卡发现的问题是否固化为永久测试，同样按下方规则判断。

## 永久测试与一次性验证

默认不写测试。只在修好用户或真机发现的 bug 后为防止复发，或大改已验收功能前用端到端测试锁住现有行为时新增自动测试。已有测试失败时先判断是代码缺陷还是测试过时；过时就直接改或删，不为测试本身返工。

清单的 `keep` 仅表示已有测试的领域标签：`data` 数据安全、`main` 日常主路径、`boundary` 保护边界、`compat` 生态兼容；它不构成额外准入条件。真实卡、平台与远程模型的按需验证沿上述探针执行，结果按实际完成范围报告。

## 构建环境与 Debug

使用 Gradle Wrapper、JDK 17 或更高版本（Android Studio 自带的 JDK 即可）及 Android SDK；所需平台见 [app/build.gradle.kts](../app/build.gradle.kts) 的 `compileSdk`。门禁脚本按 `ANDROID_SDK_ROOT`/`ANDROID_HOME` 或 `local.properties` 的 `sdk.dir` 查找 SDK；用 Android Studio 打开项目会自动生成 `local.properties`。仅需 Debug 构建时运行：

```powershell
.\gradlew.bat :app:assembleDebug
```

Debug APK 输出到 `app/build/outputs/apk/debug/app-debug.apk`。

构建自行签名的 Release 时，把以下四项写入被 Git 忽略的 `local.properties`，签名文件放在仓库外，然后运行 `.\gradlew.bat :app:assembleRelease`，产物输出到 `app/build/outputs/apk/release/app-release.apk`：

```properties
yeyu.signing.storeFile=<签名文件绝对路径>
yeyu.signing.storePassword=<密码>
yeyu.signing.keyAlias=<别名>
yeyu.signing.keyPassword=<密码>
```

自行签名的包与官方发布包证书不同，Android 不允许二者互相覆盖安装；换装前需先卸载，而卸载会清空应用内的全部数据。官方发布包由下方 Release 门禁使用原证书构建并核验。

## 版本身份

- `versionName` 是正式版本号 `X.Y.Z`（不带预发布后缀），显示在应用侧栏与「关于」页，并用于和公开仓库的正式发布对比是否有更新。正式 tag 为 annotated `vX.Y.Z`；tag 不复用、不移动。`1.0.0` 之前的正式发布使用 `vcNNN` tag（编号即当时的 `versionCode`），保持原样，排序早于所有 `vX.Y.Z`。
- `versionCode` 只增不减：每个交付的不同 APK 字节（包括同一版本号下的候选修订）都使用一个新的、高于全部正式 tag 的 `versionCode`。同一版本号的候选以修订号 `rN` 区分，`versionName` 保持不变。覆盖安装要求包名与签名一致，且 `versionCode` 不低于已安装版本。
- Release 门禁会检查上述规则，并要求 `versionName` 新于最新正式 tag、对应的 `vX.Y.Z` 尚不存在。产物身份由 `versionName`、`versionCode`、SourceRef commit 和 APK SHA-256 共同确定。
- 稳定基线是最新正式 annotated tag，该 tag 精确指向稳定 APK 的 SourceRef；无法从源码重新生成的交付身份（交付文件名、`versionName`、`versionCode`、APK 大小与 SHA-256）写入 tag 注释。

## 1. 构建前保护

- [ ] 创建职责单一的本地候选源码 commit；该 commit 是当前 clean HEAD，也是 Release 的完整 40 位 `SourceCommit` / APK `SourceRef`。受保护 Prompt 身份/哈希核对与完整回归由 Release 门禁本身承担。
- [ ] `app/src/main/assets/` 文本使用 LF，HTML 脚本和样式加载顺序正确。
- [ ] API Key、Token、密码、签名凭据、用户数据、本机路径和私密内容未进入源码、夹具、日志或文档。
- [ ] 月牙对话气泡普通及圆形图标、文件选择器、Activity result、受限原生桥和 MediaStore 能力仍存在。

## 2. 原证书 Release

- [ ] `local.properties` 从仓库外引用原签名，签名文件和密码不进入 Git。
- [ ] 按上述 Release 入口完成构建与核验，构建来源满足[产品边界](ARCHITECTURE.md#9-产品边界)的原包保障。
- [ ] 包名、版本、SDK、v2 与原证书核验通过；证书 SHA-256 以[产品边界](ARCHITECTURE.md#9-产品边界)为准，由 `tools/qa/verify_apk.ps1` 机器核验。
- [ ] APK 内全部 assets 与候选源码 `SourceRef` 逐字节一致，没有缺失或多余文件。

## 3. 真机与发布收口

- [ ] Release 使用构建时 clean HEAD；独立 APK 核验使用候选源码。
- [ ] 只提交候选源码，不提交 APK、build、日志、密钥或本地配置。
- [ ] 候选身份记录：文件名、包名、`versionName`、`versionCode`、`SourceRef`、大小、SHA-256、Release 结果、签名方案和证书核验。
- [ ] 覆盖安装不得要求卸载、清数据、降级或换签名。卸载会删除 WebView 本地数据。
- [ ] 真机验收通过后，先确认 `main` 已包含候选源码与必要测试修正，再创建 annotated `vX.Y.Z` tag，精确指向候选源码 commit（即 APK `SourceRef`），注释写入交付身份。
- [ ] 公开发布的 `vX.Y.Z` 源码与 APK 字节对应：在该 tag 的源码上运行 `pwsh -NoProfile -File tools/qa/verify_apk.ps1 -Apk <APK> -SourceRef <tag 指向的完整 commit>`，核对版本、原证书与全部 assets 逐字节一致。

## 4. 发布文件命名

交付文件名包含 `versionName` 与修订号，例如 `夜欲-1.0.0-r1-<主题>.apk`；不同字节的包必须使用唯一修订号。公开 Release 附件命名为 `yeyu-<versionName>.apk`，只上传真机验收通过的那份字节。稳定交付身份以 tag 注释为准，不靠文件名区分候选与稳定版本。
