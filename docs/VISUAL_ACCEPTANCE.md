# 真机视觉验收

主视觉参考为一加 13 实机。参数权威文件为 [visual_device_profile.json](../tools/fixtures/visual_device_profile.json)；其他测试中的 360、390、430 等尺寸用于辅助适配和行为回归，不能视为真机截图。

截图只用于开发自查，属于可再生成的临时产物，不提交到仓库。视觉效果以真机验收为准；自查结论附实现、实测尺寸与验证结果。

## 测量来源与边界

物理屏幕、有效显示密度、系统字体缩放、原生窗口及系统栏占用由 ADB 读取；最近采集日期与证据类型见参数文件的 `measuredAt` 和 `evidence`，实测数值保存在 `physicalPixels`、`effectiveDensityDpi`、`fontScale`、`nativeWindowDp`、`nativeWebViewPixels`、`systemBarPixels`。

浏览器参考由 `browserContext` 和 `nativeSafeAreaCss` 指定，经 [visual_device.js](../tools/qa/visual_device.js) 注入视口、DPR、触摸设置与安全区。不要先扣除系统栏再注入安全区，否则会重复扣除；模拟截图尺寸可能因舍入与物理屏幕相差一个像素。

参数文件里的值是**原生窗口实测与 CSS 参数推导**，不是页面内实测值。WebView 远程调试的连接条件与边界见 [架构说明 §6](ARCHITECTURE.md#6-原生桥与导航边界)；连上后应直接读取 `innerWidth/innerHeight`、`visualViewport`、实际 `devicePixelRatio` 和 WebView 文本缩放来核对推导参数。模拟不能复现系统字体渲染、手机物理尺寸，也不能替代真机确认文字/按钮大小。不要为了采集参数覆盖安装、清空数据或调整用户显示设置。

## 复测与使用

手机竖屏、夜欲在前台、键盘关闭时运行：

```powershell
node tools/probes/read_phone_visual_profile.js
```

多设备时在末尾指定设备序列号；ADB 非默认位置可设置 `ADB_PATH`。脚本只读取和输出显示参数，不保存原始 activity dump、聊天内容或序列号，不自动更新基线。调整系统显示大小、分辨率、字体或系统升级后重新采集并核对参数文件。

视觉自查的背景图使用真实角色卡，并在命令中显式传入图片路径：提色、叙述语义色和面板可读性都取决于真实插画，省略图片时的合成背景只作辅助，不能单独作为视觉结论。没有真卡时可先用合成背景核对布局和交互，涉及真实插画的视觉结论标为未验证，待取得原卡后补验；不能据此判定视觉通过。下列探针都加载共用 `tools/qa/visual_device.js` 与参数文件；新增视觉脚本应复用这套参数和安全区注入。探针只重现所运行源码的页面，历史版本外观须使用对应源码。

聊天壳多状态截图：`node tools/probes/chat_shell_visual.js [角色图片路径或-] [标签] [人格头像路径]`。省略图片时生成背景色测试图，标签 `muted` 使用低饱和灰绿，其余使用高饱和渐变。图片只作为背景与头像读取，角色、会话和对话均由脚本构造，不导入或执行图片内的角色卡脚本。前两张为无角色页的深浅主题。结果位于 `.tmp/chat-shell-rework/oneplus13-pjz110/<标签>/`，附各状态 DOM 尺寸、字体度量、常驻高度和页面错误记录。输入焦点截图不包含真实 Android 软键盘。

管理页面与二级界面截图：`node tools/probes/ui_workflows_visual.js [角色图片路径或-] [标签]`。使用同一设备参数与只读图片边界，结果写入 `.tmp/ui-workflows-visual/oneplus13-pjz110/<标签>/`。`daylight` 或 `generated` 标签覆盖所有弹窗及主要展开态，其他标签覆盖深浅目的地、选择器、卡片设置和反馈。探针只执行受控空操作脚本核对脚本库外壳层级，不运行图片内的脚本；模拟 IME 回调只验证可用区域与导航布局，不代表实际键盘外观或真机流畅性。

在同一命令后加 `--page-tabs` 只采集无角色页面与三个目的地的深浅主题、初始及滚动状态，输出 `.tmp/ui-page-tabs/oneplus13-pjz110/<标签>/`。静态截图等待有限时长的过渡完成，循环进度反馈不阻止采集。

加 `--wheel-manager-only` 只采集转盘人物志设置（顶部与滚到底的输出上限）的深浅主题，仍使用同一设备参数与隔离样本。

加 `--wheel-game-only` 只采集转盘对局页的深浅主题，输出 `.tmp/ui-wheel-game/`：多数值进行中（收起与展开）、120 项展开、2 项单轮盘、无数值、人物志思考中（收起与展开）与正文生成中、完成、失败、方案无法继续，以及转动弹窗转动前与停下后。方案与进度由脚本合成，不调用模型。

立绘展示验收：`node tools/probes/expression_stage_visual.js <含标准 emotion 的角色卡.png>`。只读解析图片，不运行卡片脚本或模型；按一加 13 参数采集普通/VN 舞台、换图与隐藏过渡、减少动态效果、键盘/iframe 避让及跨会话清图，结果在 `.tmp/expression-stage-visual/oneplus13-pjz110/`。

浏览器动效演示：`node tools/probes/ui_workflows_visual.js - vivid --motion-preview`，输出 `.tmp/ui-motion-preview/oneplus13-pjz110/vivid/motion-preview.mp4` 与 `timeline.json`。使用本机已有 FFmpeg（通过 PATH 或 `FFMPEG_PATH` 定位）编码 Edge 采集帧，30 fps 是视频编码设置，不能用于判断实际手机帧率；输入焦点没有真实 Android 键盘。

检查顶部/底部安全区、文字与按钮密度、可见内容量、入口和弹窗，最后在手机同一显示设置下核对。
