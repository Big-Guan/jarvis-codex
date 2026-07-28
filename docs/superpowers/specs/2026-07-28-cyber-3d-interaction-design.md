# Jarvis 展示级赛博 2.5D 交互设计

## 目标

在不改变 Codex Voice、线程、权限和 Tauri 后端行为的前提下，把当前主舞台从“平面 HUD 叠加图片”升级为“克制的全息中枢”。首期保留现有头像和信息架构，通过分层景深、前后景遮挡、扫描光锥、空间粒子和语音状态联动，形成适合演示又能长期使用的展示级 2.5D 效果。

## 设计原则

- 主色保持青蓝；`working` 使用琥珀；`stopped` 和严重错误使用红色。
- 语音状态主导运动，鼠标只提供小幅视差，避免把办公工具做成需要操控的游戏场景。
- 文字、字幕、按钮和 Agent 状态始终处于清晰的二维信息层。
- 不引入 Three.js、真实 3D 模型或 WebGL 着色器。
- 目标环境为 macOS 13+ WKWebView，主尺寸 1440×900，最低尺寸 960×620。

## 空间结构

主舞台使用约 `1100px` 透视并划分为三层：

1. 远景位于约 `translateZ(-120px)`，包含低对比数据网格、光雾和有 Z 轴速度差的粒子。
2. 中景保留头像，通过重复裁切形成背部光晕、主体和前部高光三张深度切片。
3. 近景位于约 `translateZ(80px)` 到 `translateZ(160px)`，包含轨道环、刻度、扫描弧、声波、前景遮挡弧和体积扫描光锥。

场景根据指针位置最多水平倾斜 ±4°、垂直倾斜 ±2.5°，指针离开后平滑回正。轨道环必须使用不同的 Z 轴、方向和周期，不能作为一个平面整体旋转。

## 状态动效

| 状态 | 动效 |
| --- | --- |
| `booting` | 远景、头像和 HUD 在约 900ms 内从不同深度组装 |
| `ready` | 青蓝低亮呼吸，轨道以 18–28 秒周期缓慢运行 |
| `voice-starting` | HUD 环在约 650ms 内收束，形成链路锁定 |
| `listening` | 麦克风能量驱动波形、内环扩张和眼部亮度 |
| `working` | 平滑切换琥珀色，数据脉冲从中心流向 Agent 区域 |
| `speaking` | 扬声器能量驱动由内向外的空间涟漪 |
| `degraded` | 停止高速运动，以短促琥珀切片表达故障 |
| `stopped` | 红色快速收束后保持静止，不持续闪烁 |

## 工程边界

视觉逻辑从 `src/main.ts` 抽离到独立控制器，只通过以下内部接口与业务层通信：

```ts
type VisualMode =
  | "booting"
  | "ready"
  | "voice-starting"
  | "listening"
  | "working"
  | "speaking"
  | "degraded"
  | "stopped";

interface CyberStageController {
  setMode(mode: VisualMode): void;
  setAudioLevels(levels: { mic: number; speaker: number }): void;
  destroy(): void;
}
```

一个 `requestAnimationFrame` 循环统一处理声波、粒子、空间涟漪和视差平滑。Canvas 设备像素比上限为 2；窗口隐藏时暂停；重新显示时恢复当前状态。业务层仍是 `data-mode`、Voice 生命周期和音频分析数据的唯一事实来源。

## 降级与可访问性

- `prefers-reduced-motion` 下关闭粒子、视差、组装、高速旋转和持续涟漪。
- 降级模式保留颜色、透明度和文字状态变化。
- 所有纯视觉层使用 `pointer-events: none`。
- 控制区和字幕对比度不得低于当前版本。
- 视觉控制器销毁时必须移除指针、可见性、媒体查询和尺寸监听。

## 验收

- 八种 `VisualMode` 都具有明确且可辨认的反馈。
- 连续语音输入、远端语音输出和任务执行期间没有明显掉帧。
- 1440×900 与 960×620 均无溢出、遮挡或不可点击区域。
- 隐藏窗口后动画停止，重新显示后正确恢复。
- `npm run check` 全部通过。
- 保留两档窗口尺寸的视觉截图用于贡献说明。
