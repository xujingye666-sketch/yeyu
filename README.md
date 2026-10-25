# 夜欲

夜欲是一款在 Android 手机本地运行的角色对话应用。它可以导入 SillyTavern 与 RisuAI 格式的角色卡，以及 SillyTavern 的预设和世界书，连接你自己配置的模型服务进行对话。角色、聊天和设置都保存在手机本地。

<p>
  <a href="docs/images/home.jpg"><img src="docs/images/home.jpg" width="240" alt="深色首页"></a>
  <a href="docs/images/character-layout.jpg"><img src="docs/images/character-layout.jpg" width="240" alt="角色卡自定义排版"></a>
  <a href="docs/images/chat-bubbles.jpg"><img src="docs/images/chat-bubbles.jpg" width="240" alt="气泡对话"></a>
</p>

以上为实际界面截图，依次为深色首页、角色卡自定义排版与气泡对话。图中的角色、背景和开场白均来自角色卡与用户配置，非应用内置内容，相关素材权利归原权利人所有。点击图片可查看原图。

## 主要功能

- 导入 PNG、JSON 和 CHARX 角色卡，支持角色卡自带的世界书、开场白、正则脚本、前端页面与脚本。
- 支持 SillyTavern 预设、世界书、人格、快捷回复和 STScript，以及酒馆助手脚本、MVU 变量与提示词模板。
- 支持 RisuAI 卡片的 CBS、触发器、Lua、世界书、模块与显示效果；兼容范围与已知差异见[兼容矩阵](docs/COMPATIBILITY_MATRIX.md)。
- 模型服务支持 OpenAI 兼容接口、Anthropic、Google Gemini 和 Grok 订阅，可分别为对话与辅助任务指定模型。
- 支持长对话记忆整理、向量检索、附件资料库、立绘表情、图片生成、语音朗读、消息翻译、支线对话与转盘玩法。

## 安装

前往 [Releases](https://github.com/xujingye666-sketch/yeyu/releases) 下载最新的 `yeyu-<版本号>.apk` 安装，系统需为 Android 13 或更高版本。更新版本时直接覆盖安装即可，聊天数据会保留。

应用启动或切回前台时会自动检查有无新的正式版（每天最多一次），也可以在侧栏版本号旁的「关于」中手动检查。发现新版本后，点击「前往更新」会在浏览器中打开发布页面，下载后覆盖安装即可。

## 开始使用

1. 打开「设置」，填写模型服务的 API 地址、Key 和模型名称。
2. 在侧栏「角色」中导入角色卡，或直接新建角色。
3. 选择角色开始对话；预设、世界书和人格可在各自页面中管理。

数据保存在应用内部存储中，卸载应用会清空全部数据。

## 自行构建

构建需要 JDK 17 或更高版本（可直接使用 Android Studio 自带的 JDK）和 Android SDK 35。

```powershell
.\gradlew.bat :app:assembleDebug
```

生成的 APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。如需构建自己签名的 Release 版本，请参照[发布检查清单](docs/RELEASE_CHECKLIST.md#构建环境与-debug)配置签名。自签名版本与官方发布版的签名证书不同，无法直接互相覆盖安装；切换时需先卸载原应用，注意这会清空应用内的全部数据。

## 开发与测试

测试与门禁脚本需在 Windows 下运行，依赖 PowerShell 7、Git、Python、Node.js 和 Microsoft Edge。首次运行前先在项目根目录执行 `npm ci`，然后运行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/qa/run_project_checks.ps1 -Gate Fast
```

刚克隆仓库且尚未拉取正式 tag 时，可加上 `-BaselineRef HEAD`。验证方式、测试准入和版本规则见[发布检查清单](docs/RELEASE_CHECKLIST.md)，代码结构见[架构说明](docs/ARCHITECTURE.md)与[前端模块索引](docs/FRONTEND_MODULES.md)，数据格式见[数据模型](docs/DATA_MODEL.md)，界面规范见 [DESIGN.md](DESIGN.md)。

## 许可

本项目采用 [GNU Affero General Public License v3.0](LICENSE) 许可证发布。随应用分发的第三方库、字体和素材仍适用其原有许可，具体来源与许可证文件见[本地发行依赖](docs/FRONTEND_MODULES.md#本地发行依赖)。应用图标由 OpenAI 图像生成工具制作，源图与适配图随项目按 AGPL-3.0 分发。

## 联系

xujingye666@gmail.com
