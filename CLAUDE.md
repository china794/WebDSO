# WebDSO — 纯原生网页示波器

基于 Web Audio API / Web Serial API / WebGL 的 8 通道示波器，零外部依赖。

## 架构概览

```
index.html              ← 单页入口，含完整 DOM
├── styles/
│   ├── layout.css      ← 主布局 + CSS 变量主题系统
│   ├── osd.css         ← 屏幕叠加显示层（OSD/通道颜色）
│   └── controls.css    ← 右侧控制面板全部组件
└── js/
    ├── main.js         ← 引导入口，初始化所有模块
    ├── core.js         ← 核心状态 STATE + DOM 缓存 + 数据 Buffers
    ├── store.js        ← 轻量响应式 Store（可选工具）
    ├── constants.js    ← 全系统常量集中管理
    ├── channel.js      ← Channel / ChannelManager 类
    ├── signal.js       ← 触发搜索、AC/DC 耦合、测量、FFT
    ├── audio.js        ← WebAudio 音频图（8通道拓扑）
    ├── serial.js       ← WebSerial 引擎（协议解析 + 环形缓冲区 + 音频监听）
    ├── shaders.js      ← WebGL 着色器源码
    ├── utils.js        ← 工具函数 + EventManager
    ├── lib/fft.js      ← Radix-2 Cooley-Tukey FFT
    ├── serial/
    │   ├── protocols.js  ← JustFloat/FireWater 协议解析
    │   ├── cache.js      ← 多级降采样缓存
    │   └── audio.js      ← DC Blocker + 重采样
    ├── render/
    │   ├── index.js       ← 渲染循环主调度
    │   ├── context.js     ← ctx2d/gl/WebGL 资源共享
    │   ├── dirty.js       ← 脏标记工具类
    │   ├── canvasRenderer.js  ← 时基/触发/视角计算
    │   ├── webglRenderer.js  ← WebGL 波形绘制
    │   ├── gridRenderer.js   ← Canvas 2D 网格绘制
    │   ├── cursorRenderer.js ← 光标/小地图/悬停/触发线
    │   ├── fftRenderer.js    ← FFT 频谱图绘制
    │   ├── mathRenderer.js   ← 数学运算通道绘制
    │   └── refWaveRenderer.js ← 参考波形叠加绘制
    └── controllers/
        ├── inputController.js  ← 用户交互事件绑定
        ├── audioController.js  ← 麦克风/发生器/文件控制
        ├── serialController.js ← 串口 UI 控制
        ├── fftController.js    ← FFT 参数控制
        ├── configController.js ← 配置导入/导出
        └── themeController.js  ← 深色/浅色主题切换
```

## 核心设计决策

### 数据流
```
输入层                     处理层                    渲染层
麦克风/AWG/文件 → AudioNode → Analyser → Buffers.dataN
串口 → SerialEngine → ring buffer → fillData → Buffers.dataN
                                          ↓
                              processData(归一化) → Buffers.pDataN
                                          ↓
                              updateMeasurements + FFT
                                          ↓
                              WebGL renderGLTrace (波形)
                              Canvas 2D (网格/光标/FFT/OSD)
```

### 8 通道并行
- 每个通道独立 on/pos/scale/cpl/genType/genFreq/genAmp
- `Buffers.data1-8` 原始数据 / `Buffers.pData1-8` 归一化后数据
- 渲染循环遍历 `STATE['ch' + i].on` 决定是否绘制

### 双 Canvas 渲染
- **底层 WebGL** (`gl-canvas`)：高速抗锯齿波形绘制（GPU）
- **顶层 Canvas 2D** (`oscilloscope`)：网格、光标、FFT、OSD（CPU）
- 每帧 Canvas 2D 全量 `clearRect` → 重绘（即时模式）

### 响应式状态
- `STATE` 是普通对象（性能优先，渲染循环热路径）
- `store` 是 Store 实例（可选工具，提供 `watch/set/batch`）
- 使用 `store.set(path, val)` 可触发 watcher，`STATE.foo = bar` 直接走快路径

### 串口协议
- **JustFloat**：二进制，同步头 `[0x00,0x00,0x80,0x7F]` + float 数据
- **FireWater**：ASCII，逗号分隔数值

### 颜色主题
- CSS 变量驱动，`:root` 深色模式 / `[data-theme="light"]` 浅色模式
- 8 通道颜色：`--ch1-color` ~ `--ch8-color`
- 切换支持 View Transitions API 圆形裁剪动画

## 编码规范

### 命名
- **变量/函数**：camelCase（`updateMeasurements`, `findTriggerIndex`）
- **常量**：UPPER_SNAKE_CASE（`BUFFER.FFT_SIZE`, `TRIGGER.HYSTERESIS`）
- **类**：PascalCase（`Channel`, `ChannelManager`, `FFT`）
- **私有**：下划线前缀（`this._cacheState`, `_vboInitialized`）
- **DOM id**：kebab-case（`btn-runstop`, `osd-timebase`），JS 自动转 camelCase 映射到 DOM

### 模块原则
- 单向依赖：`constants.js` ← `core.js` ← `controllers/` ← `render/`
- 渲染上下文通过 `render/context.js` 共享，不通过 index.js 重新导出
- 数据缓冲区在 `core.js` 中声明，`main.js` 中调用 `bindBuffers`

### 性能注意事项
- `STATE` 不走 Proxy（渲染循环每帧几百次访问，Proxy 开销不可接受）
- `Buffers` 使用 Float32Array（TypedArray.set 批量复制）
- `renderGLTrace` 使用峰值保持算法优化渲染点数
- 测量结果有 CACHE 机制抑制重复 DOM 写入

## 关键功能入口

| 功能 | 文件 | 函数/类 |
|---|---|---|
| 渲染循环 | `render/index.js` | `draw()` |
| 信号处理 | `signal.js` | `processData`, `updateMeasurements`, `findTriggerIndex` |
| 数学运算 | `signal.js` | `updateMathData` |
| 串口引擎 | `serial.js` | `SerialEngine` |
| 音频图 | `audio.js` | `initAudio`, `rebuildChannel` |
| WebGL 波形 | `render/webglRenderer.js` | `renderGLTrace`, `renderWaveforms` |
| FFT | `lib/fft.js` | `FFT.forward` |
| 配置导入导出 | `controllers/configController.js` | `initConfigController` |
| Autoset | `controllers/inputController.js` | 按钮事件中 |
