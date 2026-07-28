# Jarvis 展示级赛博 2.5D 交互实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 保留现有业务行为，为 Jarvis 主舞台增加展示级三层景深、语音状态动效、前后景遮挡、扫描光锥和性能降级。

**架构：** `main.ts` 继续拥有 Voice 和线程状态，新的 `cyber-stage.ts` 只消费模式与音频电平。DOM 提供远景、中景、近景和双 Canvas，CSS 负责合成层与状态令牌，单一 RAF 控制器负责粒子、波形、涟漪和视差。

**技术栈：** TypeScript、CSS 3D transforms、Canvas 2D、Tauri 2、Node test、Vite。

---

## 文件结构

- 创建 `src/cyber-stage.ts`：视觉模式类型、音频归一化、RAF、Canvas 和监听器生命周期。
- 修改 `src/main.ts`：构建三层场景 DOM，并把现有模式与音频电平接入视觉控制器。
- 修改 `src/style.css`：景深结构、状态令牌、扫描光锥、遮挡弧和 reduced-motion 降级。
- 创建 `tests/cyber-stage.test.mjs`：验证控制器接口、数值行为、DOM 契约、八种状态和降级规则。

### 任务 1：建立视觉契约测试

**文件：**
- 创建：`tests/cyber-stage.test.mjs`
- 测试：`tests/cyber-stage.test.mjs`

- [ ] **步骤 1：编写失败的控制器测试**

测试读取并编译 `src/cyber-stage.ts`，断言它导出 `clampLevel`、`smoothValue` 和 `createCyberStage`，并验证：

```js
assert.equal(clampLevel(-1), 0);
assert.equal(clampLevel(2), 1);
assert.equal(clampLevel(Number.NaN), 0);
assert.equal(smoothValue(0, 1, 0.25), 0.25);
```

- [ ] **步骤 2：编写失败的结构测试**

断言 `src/main.ts` 包含 `depth-scene`、`depth-far`、`depth-mid`、`depth-near`、`fx-canvas`、三张 `helmet-slice` 和前景遮挡弧；断言 `src/style.css` 包含八种模式、三维合成和 `prefers-reduced-motion`。

- [ ] **步骤 3：运行测试验证失败**

运行：`npm test -- tests/cyber-stage.test.mjs`

预期：FAIL，原因是 `src/cyber-stage.ts` 和新的场景契约尚不存在。

### 任务 2：实现最小视觉控制器

**文件：**
- 创建：`src/cyber-stage.ts`
- 测试：`tests/cyber-stage.test.mjs`

- [ ] **步骤 1：实现数值与接口**

```ts
export function clampLevel(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function smoothValue(current: number, target: number, factor: number) {
  return current + (target - current) * clampLevel(factor);
}
```

实现 `createCyberStage({ root, scene, waveCanvas, fxCanvas })`，返回 `setMode`、`setAudioLevels`、`destroy`。

- [ ] **步骤 2：实现统一 RAF**

每帧平滑指针和音频目标；绘制双通道声波、Z 轴粒子和说话涟漪；把平滑值写入 `--tilt-x`、`--tilt-y`、`--mic-level`、`--speaker-level`。

- [ ] **步骤 3：实现生命周期**

监听 `pointermove`、`pointerleave`、`visibilitychange`、`ResizeObserver` 和 `prefers-reduced-motion`；隐藏时取消 RAF，恢复时重新启动；`destroy()` 移除全部监听。

- [ ] **步骤 4：运行控制器测试**

运行：`npm test -- tests/cyber-stage.test.mjs`

预期：数值与导出接口测试 PASS，结构测试仍 FAIL。

### 任务 3：接入三层场景和业务状态

**文件：**
- 修改：`src/main.ts`
- 测试：`tests/cyber-stage.test.mjs`

- [ ] **步骤 1：替换主舞台 DOM**

创建远景网格与 FX Canvas、中景三张头像切片、近景轨道环/声波/扫描光锥/前景遮挡弧，保留现有 identity 文案。

- [ ] **步骤 2：接入控制器**

应用初始化后调用 `createCyberStage`；`setMode(mode)` 同步调用控制器；`updateAudioMeters()` 传入麦克风和扬声器电平；移除旧的独立 `drawWave()` 循环。

- [ ] **步骤 3：运行结构测试**

运行：`npm test -- tests/cyber-stage.test.mjs`

预期：控制器、DOM 与状态接线测试 PASS，样式测试仍 FAIL。

### 任务 4：完成展示级 2.5D 样式

**文件：**
- 修改：`src/style.css`
- 测试：`tests/cyber-stage.test.mjs`

- [ ] **步骤 1：建立状态令牌**

定义每种模式的强调色、光强、环速、场景推进量和粒子可见度，保持青蓝、琥珀、红色的语义边界。

- [ ] **步骤 2：实现三层景深**

远景 `translateZ(-120px)`，中景头像切片分布在 `-42px`、`0`、`28px`，近景 HUD 分布在 `80px` 到 `160px`；舞台指针倾斜限制为水平 ±4°、垂直 ±2.5°。

- [ ] **步骤 3：实现强化效果**

增加头像边缘挤出光、前后景遮挡弧、体积扫描光锥、不同速度轨道、工作态数据脉冲和说话态空间涟漪。

- [ ] **步骤 4：实现降级**

在 `prefers-reduced-motion: reduce` 中关闭粒子、视差、组装、高速旋转和涟漪，只保留颜色与透明度状态。

- [ ] **步骤 5：运行全部前端测试**

运行：`npm test`

预期：全部测试 PASS。

### 任务 5：验证与视觉验收

**文件：**
- 修改：仅修复验证中发现的问题。

- [ ] **步骤 1：运行完整检查**

运行：`npm run check`

预期：Node tests、TypeScript/Vite build、Rust fmt 和 clippy 全部 PASS。

- [ ] **步骤 2：运行 Web 预览**

运行：`npm run web:dev -- --host 127.0.0.1`

在 1440×900 和 960×620 检查 booting、ready、listening、working、speaking、degraded、stopped。

- [ ] **步骤 3：验证交互与降级**

确认按钮和输入框可点击、指针离开后回正、窗口隐藏暂停、reduced-motion 不出现持续运动。

- [ ] **步骤 4：保存截图并复查 diff**

保存两档截图用于贡献说明；运行 `git diff --check` 和 `git status --short`，确认没有构建产物或无关改动。
