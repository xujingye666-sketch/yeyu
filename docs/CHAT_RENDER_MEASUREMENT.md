# 长聊天渲染测量

入口：[chat_render_measure.js](../tools/probes/chat_render_measure.js)。复用 Edge、Playwright 与 Node CDP，不加入常规耗时门禁；命令参数、输出字段与派生字段清单以探针代码为准。本文只规定测量含义、数据边界与已知误差。

## 运行

```powershell
# 桌面稳态重绘；场景产物默认写入 .tmp/chat-render-measure/<mode>
node tools/probes/chat_render_measure.js desktop --card <角色卡.png> --ready-timeout 300000
# 一次性展开历史 / 卡片重挂
node tools/probes/chat_render_measure.js desktop --card <角色卡.png> --scenario expand-all --messages 1200 --ready-timeout 300000
node tools/probes/chat_render_measure.js desktop --card <角色卡.png> --scenario remount --ready-timeout 60000
# 真机当前会话与桌面结果对照
node tools/probes/chat_render_measure.js android --serial <设备序列号> --compare .tmp/chat-render-measure/desktop/desktop.json
```

真机测量须经设备主人同意：设备已开启并授权 USB 调试、已连线，主人在场且目标会话前台空闲。只连指定设备上已运行的夜欲及唯一资产页，不启动、安装或切应用；普通 `android` 测量不导入合成数据、不接受场景或消息条数参数。只建立临时 ADB 转发，结束移除自己创建的转发。接入边界见 [架构说明 §6](ARCHITECTURE.md#6-原生桥与导航边界)。

用 `--out` 隔离复测。普通计时、分段计时、Profiler 各至少 5 个样本。失败必须保留已取得的样本和守卫结果；连接或初始快照失败不得开始重绘。卡片很多时就绪可能耗时数分钟，可扩大 `--ready-timeout`，不能把超时当通过。

## 合成会话口径

桌面与真机临时会话共用合成：原卡首个非空开场白开头，之后交替固定用户短句与同一开场白。每条助手消息保留原卡正文，使卡片前端与正则按实际条数运行。角色卡走真实导入与开场白入口，不能以简化夹具替代素材、脚本和世界书路径。

两项必要的布局前提：

- 渲染前切到聊天页；隐藏页面里的 iframe 为 0×0，无法上报真实高度，既不会就绪也不代表真实成本。
- `renderChat()` 后调用产品打开会话同用的 `scrollChatToBottomAfterRender()`；否则停在顶部，测的不是打开会话。结合滚到底前后 gap 判断位置。程序化 scrollTop 不算用户上滑，不能借此触发自动加载历史。

## 就绪判定

页面 `__yeyuIdleSnapshot()` 是所有初始闸门、样本、一次性场景共用的唯一判定，不各自复制。必须连续两帧无挂载/脚本文本/Risu/模板待办，脚本库就绪，已挂载帧解析完文档并上报真实高度。

懒挂载下没有帧的位置是正常占位，不算未就绪；卡片位置、占位与运行帧分开计数。不能要求文档 `complete`：计时不含图片下载，真实卡片可能长期停在 `interactive`；未 complete 的帧只报告不阻塞。旧基线缺少懒挂载全局量时仍用其帧口径比较。

任一场景的 `gate.state.bottomGapPx` 可检查是否停在底部。就绪超时要保留当时 DOM、帧、高度就绪与待办状态，而非丢弃失败样本。

## 数据守卫

普通探针只主动调用显示/读取路径，不发送、swipe、编辑、删除或设置。但显示路径会常规持久化，**不能称纯只读**；不阻断保存、不克隆替换手机数据、不在失败后回写恢复。

每个样本开始前持有本轮主数据基线，结束立即核对，变化即终止后续轮次。守卫覆盖完整消息、角色原始字段与扩展/资产、世界书、有效正则及媒体资产身份，不只比正文。具体字段与明确允许的加载/记忆/Risu 派生变化以代码守卫清单为准；不得扩大派生豁免以掩盖主数据写入。

每项派生变化也须记录路径、前后存在性、类型、字节数与哈希；Blob/数组按实际字节算，等长替换不能漏掉。报告只存摘要，不存变量值、正文、原卡文本、凭据或媒体字节。未完成核对为 null，不是通过；派生变化不算主数据失败，但不能省略记录。

## 计时口径

稳态采用 [手机基准](VISUAL_ACCEPTANCE.md)，外网关闭、等初始闸门后再测；构造与首次加载不计入热测量。`renderMs` 是同步重绘，`settledMs` 是重绘开始到共用就绪判定，不等图片。锚点采真实阅读位置，不走 follow 快速返回。稳态不展开历史，也不代表首次打开或滚动帧率。

分段包装必须透传原参数、接收者、返回值与 Promise，finally 恢复；同步分段扣掉子调用，不能重复计时。显示正则含缓存、Markdown 含净化，不是纯引擎耗时。Risu Markdown 延后到帧同步（outside），Risu 提前返回不能用于估计 ST 帧成本。未调用项次数为 0、中位为 null。

Profiler 每样本独立采样、结束后再算守卫哈希；普通计时、就绪与 CPU 排名不混入哈希成本。按函数位置合并至少 5 个窗口的自耗时，排除 idle/root、保留 program/GC，不落原始 profile、脚本正文或卡片 URL。

桌面/真机倍率仅对成功结果计算；两边会话与浏览器可能不同，**只能称场景对照，不能称硬件性能倍率**。解读时同时看环境、源码/探针/原卡身份与 `pageErrors`；有未捕获错误不能只引用速度数字。

真机进程采样的踩坑约束：

- `top` 必须显式指定 `PID,%CPU,RES,ARGS`；toybox 默认表头会并列错位。
- 按 PID 分行，不能按同名 sandbox 进程归并，其他应用也会同名。用父子关系认定归属；取不到进程树时归属为 null，仍逐 PID 保留。
- RES 带 M/G 后缀，无后缀按 KB。前后采样各取 5 次中位数。
- ADB 输出缓冲给足 64 MB；套接字存在性在设备端查，不整读 `/proc/net/unix`，否则偶发命令失败。

## 跳转到对话开头场景

`expand-all` 从默认窗口就绪后调用真实跳开头入口；旧基线缺该入口才回退旧展开动作，报告注明路径。测调用到首条进入视口、再到共用就绪判定；同步重绘时间累加全部跨帧调用，不能只取第一次。此为一次性场景，不作中位统计，也不执行主数据守卫或 Profiler，不得套用稳态的守卫通过结论。

## 卡片重挂场景

`remount` 先测未挂过的冷帧，再访问不相交位置挤出前组，最后回原组测带记忆高度的热重挂。计时从程序滚动起算，包含固定滚动静默时间，报告须分列；仍存活而未重挂的位置不能算热样本。运行帧峰值不应超过常规上限加钉住的最新卡片消息。该一次性场景不做主数据守卫或 Profiler。

验收跳动用 `readingShiftPx`：产品阅读锚点稳定后需要补偿的滚动量。`offsetShiftPx` 只是被居中行的位移，该行在锚点下方，上方卡片长高本就会推动它，只供参考。

## 真机临时长会话

创建/删除真机会话须设备主人另行明确同意，普通测量的同意不包含这一步。桌面演练不触真机：

```powershell
node tools/probes/chat_render_measure.js android-temp-session create --serial <序列号> --character-name <角色完整名称> --messages 300
node tools/probes/chat_render_measure.js android-temp-session delete --serial <序列号>
node tools/probes/chat_render_measure.js android-temp-session rehearse --card <角色卡.png>
```

创建按完整规范名精确匹配（含标点），必须唯一；只新增带探针临时前缀的会话，不改旧会话，先记录原活动身份和全部会话 id/条数。进入角色前就设临时会话为活动项，否则可能弹出探针无法回答的开场白/作者注记。

删除只认临时前缀；其下有非临时支线或删后无任何会话则拒绝。完成后恢复原活动会话并保存，与创建清单逐项比对。原角色活动会话为空且未选开场白时不回切角色，明确报告未恢复，由用户自行进入。桌面演练复用同一创建/删除逻辑并检查清单一致，不能另写一套模拟代替。
