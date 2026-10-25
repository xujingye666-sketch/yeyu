# SillyTavern 官方语义对照

本页固定本地 SillyTavern 对照环境的身份和复现步骤；下文 `<ST 对照目录>` 指按下表身份检出的本地 SillyTavern 目录。对照环境只用于判断作品在官方宿主中的加载、调用与运行语义；不得修改其源码、插件、版本或配置。

## 固定身份

| 组件 | 本地路径 | 身份 |
|---|---|---|
| SillyTavern | `<ST 对照目录>` | `1.19.0`；HEAD `7e8663cd9c184a550b37238218bdd32c6efc68e9`；tag `1.19.0` |
| 酒馆助手 / JS-Slash-Runner | `data\default-user\extensions\JS-Slash-Runner` | `4.11.3`；HEAD `1292dbfa0f16943f70d55cfdf3bb5a0ce690ef8b`；`dist/index.js` SHA-256 `E735F6EE5A0C2198DC980847F9B6284E3D36D6B394BBE38B0C4D801482FBA7F7` |
| 提示词模板 / ST-Prompt-Template | `data\default-user\extensions\ST-Prompt-Template` | `1.17.9`；HEAD `d6f520d149aba146305b0b781ddd691d449c28d2`；`dist/index.js` SHA-256 `07190ADDBAE12F348CB7944DE1D5A125E1C1F686DD82540721AE58C8868A63E3` |

固定身份是复现依据，不随上游自动更新；核验脚本检查版本、提交、插件 dist 哈希、源码洁净状态及服务配置。

运行前先执行只读核验：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/probes/sillytavern_reference_verify.ps1 -ReferenceRoot <ST 对照目录>
```

任何身份不符都应先停止对照，不自动更新或修复组件。

## 启动

在 `<ST 对照目录>` 内直接启动服务：

```powershell
node server.js --browserLaunchEnabled=false
```

服务就绪后手动在浏览器打开 `http://127.0.0.1:8000/`；终端按 Ctrl+C 停止服务。对照复现不运行仓库内 `Start.bat`，避免其安装步骤改变依赖目录。启动前按 ST 的 `package-lock.json` 用 `npm ci --omit=dev --no-audit --no-fund` 安装依赖，启动命令本身不安装或更新依赖。服务配置保持 `listen: false`、`port: 8000`、`allowKeysExposure: false`。

## 导入并运行角色卡

1. 在 SillyTavern 角色列表点击 `Import Character from File`；对应官方页面控件为 `#character_import_button`，文件输入为 `#character_import_file`。
2. 选择保留支持范围内的原始 PNG/JSON，不改写原文件。
3. 打开导入后的角色，确认角色页与首条消息实际出现；需要判断运行语义时发送一条不含私人内容的短测试消息。
4. 记录卡名、源文件 SHA-256、ST/插件身份、导入是否完成、角色/首条消息是否显示，以及测试消息是否完成。不要复制角色正文、Prompt 或响应正文。

## 观察证据

用开发者工具观察 Console 与 Network。证据只记录：

- 控制台错误的类别、简短脱敏摘要和脚本位置；
- 请求 URL 的 scheme/host/path、HTTP 状态和完成/失败；
- 酒馆助手、提示词模板是否已加载，以及对应版本；
- 角色导入、首条消息和一次测试生成是否完成。

不得记录请求头、Cookie、Authorization、请求/响应 payload 或 SillyTavern 服务端原始请求日志。官方服务可能在调试日志中包含请求正文；`allowKeysExposure` 保持关闭。

## 语义复现入口

下列探针只读消费固定参考，把夜欲实现与官方语义逐项对照。命令中的 `<对照目录>` 是上表 SillyTavern 的本地路径。

| 探针 | 用途 | 命令 |
| --- | --- | --- |
| `charx_reference.js` | 用官方 `src/charx.js` 的 CharXParser 复算六种合成 CHARX 容器，逐项比对卡片 JSON、icon 与图片资产的路径和字节；夜欲额外保留的音频独立校验原字节 | `node tools/probes/charx_reference.js <对照目录>` |
| `stscript_fuzzy_reference.js` | 只读加载固定 ST 已安装的 Fuse.js，以固定随机种子生成 2000 组文本、阈值和位置参数，逐项比较 STScript 模糊匹配的命中与分值；不启动服务、不安装依赖 | `node tools/probes/stscript_fuzzy_reference.js <对照目录>` |
| `data_bank_reference.js` | 提取官方 `utils.js`、vectors、attachments 的函数实际执行，比对附件资料库的分块、重叠、文本规范化、选择器与查询取材 | `node tools/probes/data_bank_reference.js <对照目录>` |
| `tavern_helper_api_reference.js` | 在已启动的对照站点里实际调用酒馆助手公开 API，记录角色、人格、显示与注入接口的官方返回形状；只创建并删除合成夹具 | `node tools/probes/tavern_helper_api_reference.js` |
| `prompt_template_regex_patch_reference.js` | 提取提示词模板插件的 `regex`、`json-patch` 源码实际执行，比对 `75-prompt-template.js` 的 JSON 修复、补丁与动态正则，并核对本地 faker 打包与官方模块的导出名和定种结果 | `node tools/probes/prompt_template_regex_patch_reference.js <对照目录>` |

`tavern_helper_api_reference.js` 需要先按上节启动对照服务，其余四项只读磁盘文件。
