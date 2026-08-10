# Jarvis × Codex 开发任务清单

> 目标：让 Jarvis 更可 DIY、更具科技感、可以"实时驾驶"。
> 每个任务对应一个独立 PR，遵循 CONTRIBUTING.md：一个 PR 只做一件连贯的事。

## 阶段一：快速见效

- [x] **PR1 · 原生音色切换**
  - 分支：`feat/voice-selection`
  - 建立 realtime session 时透传可配置的 voice 参数（alloy/echo/shimmer 等）
  - 设置面板加音色下拉，localStorage 持久化
  - PR 中注明依赖 experimental session 配置字段

- [x] **PR2 · 口型同步**
  - 分支：`feat/lip-sync`
  - 复用现有 `state.level`（已驱动波形），映射 3~4 张口型帧
  - speaking 模式激活，安静时回落默认帧；纯前端，不动 WebRTC
  - PR 附录屏

- [x] **PR3 · 方向盘——执行中 steering 插话**
  - 分支：`feat/steering`
  - STOP 升级为 steering：打断当前输出 → 注入新指令 → 同一 thread 继续执行
  - UI 区分"转向"与"停止"两个控件
  - 触碰 Voice interruption，必须真机冒烟并在 PR 描述测试环境与结果

- [x] **PR4 · 油门——自治级别滑杆**
  - 分支：`feat/autonomy-slider`
  - safe/auto/full 三档包装为连续滑杆 UI，底层仍映射已校验 profile（不新增沙箱值）
  - 滑动实时生效，角色呼吸/扫描动画随档位变化
  - 触碰 permission profiles，需真机冒烟；PR 注明权限相关改动

- [x] **PR5 · 仪表盘——工具链与 diff 实时 HUD 流**
  - 分支：`feat/dashboard-hud`
  - 复用 worker 卡片事件源，新增可折叠 HUD：工具调用时间线、diff 摘要流、命令输出滚动
  - 只改呈现层，不改事件产生逻辑；PR 附录屏

## 阶段二：DIY 化

- [ ] **PR6 · 角色皮肤包抽象**
  - 分支：`feat/character-packs`
  - 角色图、armorShardSpecs、粒子参数、主题参数化为 pack manifest（JSON + 资源）
  - 支持目录/zip 导入，校验后落地；默认 pack 视觉零回归
  - manifest 校验加单元测试

- [ ] **PR7 · 音效包**（依赖 PR6）
  - 分支：`feat/sound-packs`
  - 四个音效钩子：唤醒、确认、任务完成、错误
  - 作为 pack 可选资源，缺省静音不报错

- [x] **PR8 · 自定义唤醒词**
  - 分支：`feat/custom-wake-phrase`
  - Swift wake helper 唤醒短语参数化，设置面板录入（中英）
  - 约束：helper 与 WebRTC 不得同时占用麦克风；变更后重启 helper 生效
  - 涉及签名/权限/冷唤醒，必须真机冒烟；PR 注明签名改动

- [ ] **PR9 · 人格卡与自定义命令**
  - 分支：`feat/persona-commands`
  - 人格卡 = 提示词前缀模板 + 开场白 + 语气风格，注入 thread 首条指令
  - 自定义命令 = 短语 → 预置 prompt/操作映射（如"早报"）
  - 命令触发逻辑加单元测试

## 阶段三：克隆音色

- [ ] **PR10 · VoiceProvider 抽象**
  - 分支：`refactor/voice-provider`
  - Rust 侧定义 trait：`speak / stop / list` + 流式音频回传通道
  - 首实现为 NullProvider，现有行为不变；API Key 存 Rust 侧，不进 WebView、不放宽 CSP
  - 架构性改动：按规范先开 issue 讨论再动工；trait 契约加单元测试

- [ ] **PR11 · 阿里云 CosyVoice 克隆音色**（依赖 PR10）
  - 分支：`feat/cosyvoice-provider`
  - 录音样本上传 → voice_id → transcript 按标点切片流式合成 → 本地排队播放
  - 打断清空合成队列；静音远端音轨只消费文本
  - 云端交互 mock 单测；PR 注明 transcript 出本机的隐私变化

- [ ] **PR12 · MiniMax 克隆音色**（依赖 PR10）
  - 分支：`feat/minimax-provider`
  - 同 PR11 模式，验证 trait 通用性；设计不足处在此 PR 修正并说明

## 阶段四：收官

- [ ] **PR13 · 车库（Garage）面板**（依赖 PR6、PR9）
  - 分支：`feat/garage`
  - 统一管理：皮肤包 / 音效包 / 人格卡 / 音色配置的列表、启用、导入、导出分享
  - 导入导出加单元测试；PR 附录屏

## 通用验收标准（每个 PR）

- `npm run check` 与 `npm run build` 通过
- Conventional commit 前缀（feat / fix / refactor / docs / test）
- 用户可见行为变化时同步更新 README.md 与 README.zh-CN.md
- UI 可见改动附截图或录屏
- 涉及麦克风、唤醒、打断、权限、签名的改动必须真机冒烟测试并在 PR 中说明
