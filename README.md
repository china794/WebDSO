# WebDSO — 纯原生网页示波器

> 基于 Web Audio API / Web Serial API / WebGL 的 8 通道数字存储示波器  
> **零外部依赖**，开箱即用，仅需一个浏览器

![WebDSO](./background/1.jpg)

---

## ✨ 功能特性

### 核心功能
- **8 通道并行显示** — 每个通道独立控制开关、垂直档位、位置、耦合方式
- **Y-T / X-Y 双模式** — 时间波形与李萨如图形切换
- **智能触发系统** — 上升/下降沿触发、自动/正常/单次模式
  - 脉宽触发 (大于/小于)
  - 触发释抑 (Holdoff)
  - HF/LF Reject 预滤波
- **实时测量** — 频率、Vpp、Vmax、Vmin、Vavg、占空比、RMS、周期
- **FFT 频谱分析** — 32768 点 FFT、线性/对数 X 轴、可调量程/增益

### 信号输入
| 输入源 | 说明 |
|---|---|
| **内置信号发生器** | SIN / 方波(PWM) / 三角 / 锯齿 / 噪声 / 扫频 / AM / FM — 每种参数可调 |
| **声卡输入** | 通过麦克风实时采集 |
| **音频文件** | 加载 FLAC/WAV/MP3 播放分析，带进度条和变速播放 |
| **串口 (Web Serial)** | 连接外部硬件设备 |

### 串口协议
- **JustFloat** (二进制) — [0x00,0x00,0x80,0x7F] 同步头 + float 数据
- **FireWater** (ASCII)
- **CSV** (逗号分隔数值)
- **JSON Lines** (每行 JSON 对象或数组)

### 高级功能
- **波形数学运算** — A+B / A-B / A×B / A÷B / d/dt / ∫
- **参考波形** — 保存当前波形为半透明参考叠加
- **光标测量** — Y 轴电压光标 / X 轴时间光标，可拖拽
- **Autoset** — 一键自动设置最佳档位和触发
- **配置导入/导出** — 完整状态序列化，含波形数据快照
- **PNG 截图导出** — 合成 WebGL 波形 + Canvas2D 叠加层

### 用户体验
- **4 种主题** — 深色 / 浅色 / 经典绿 / 琥珀色
- **触摸手势** — 双指缩放时基、双指平移、长按冻结
- **滚轮缩放** — 波形区滚动缩放时基、Shift+滚动垂直缩放
- **折叠面板** — 控制面板各分区可折叠收起
- **PWA 支持** — 可安装到桌面、离线缓存
- **性能监控** — 实时 FPS / 帧耗时 / 串口采样率

---

## 🚀 快速开始

### 本地运行

```bash
# 使用 Python
python -m http.server 8080

# 或使用 Node.js
npx serve .

# 或使用 VS Code Live Server 扩展
```

打开浏览器访问 `http://localhost:8080`

### 在线体验

访问部署后的页面即可使用，无需安装任何软件。

---

## 🏗️ 项目结构

```
index.html              ← 主入口，含完整 DOM 结构
├── styles/
│   ├── layout.css      ← 主布局 + CSS 变量主题系统
│   ├── osd.css         ← 屏幕叠加显示层
│   └── controls.css    ← 控制面板全部组件
├── js/
│   ├── main.js         ← 引导入口
│   ├── core.js         ← 状态管理 + DOM 缓存 + 数据缓冲池
│   ├── store.js        ← 轻量响应式 Store
│   ├── constants.js    ← 全系统常量集中管理
│   ├── channel.js      ← Channel / ChannelManager 类
│   ├── signal.js       ← 信号处理（触发/测量/FFT）
│   ├── audio.js        ← WebAudio 音频图 + 信号发生器
│   ├── serial.js       ← WebSerial 引擎
│   ├── shaders.js      ← WebGL 着色器源码
│   ├── utils.js        ← 工具函数
│   ├── i18n.js         ← 国际化
│   ├── lib/fft.js      ← Radix-2 Cooley-Tukey FFT
│   ├── serial/         ← 串口协议子模块
│   │   ├── protocols.js  ← JustFloat/FireWater/CSV/JSON 协议
│   │   ├── cache.js      ← 多级降采样缓存
│   │   └── audio.js      ← DC Blocker + 重采样
│   ├── render/         ← 渲染子系统
│   │   ├── index.js       ← 渲染循环调度
│   │   ├── context.js     ← WebGL/Canvas2D 上下文
│   │   ├── webglRenderer.js  ← WebGL 波形绘制
│   │   ├── gridRenderer.js   ← 网格绘制
│   │   ├── cursorRenderer.js ← 光标/小地图/悬停
│   │   ├── fftRenderer.js    ← FFT 频谱绘制
│   │   ├── canvasRenderer.js ← 时基/触发计算
│   │   ├── mathRenderer.js   ← 数学运算通道
│   │   ├── refWaveRenderer.js ← 参考波形
│   │   ├── perfMonitor.js    ← 性能监控
│   │   └── dirty.js        ← 脏标记工具
│   └── controllers/    ← 控制器
│       ├── inputController.js  ← 用户交互
│       ├── audioController.js  ← 音频控制
│       ├── serialController.js ← 串口控制
│       ├── fftController.js    ← FFT 控制
│       ├── configController.js ← 配置导入/导出
│       └── themeController.js  ← 主题切换
├── audio/              ← 示例音频文件
├── background/         ← 背景图片
├── manifest.json       ← PWA 应用清单
├── sw.js               ← Service Worker
├── icon-192.svg        ← 应用图标
├── icon-512.svg
└── CLAUDE.md           ← AI 辅助开发文档
```

---

## 🧠 核心架构

### 数据流

```
输入层                    处理层                    渲染层
麦克风/AWG/文件 → AudioNode → Analyser → Buffers.dataN
串口 → SerialEngine → ring buffer → fillData → Buffers.dataN
                                        ↓
                            processData(归一化) → Buffers.pDataN
                                        ↓
                            updateMeasurements + FFT
                                        ↓
                            WebGL (波形) + Canvas2D (网格/光标/OSD)
```

### 双 Canvas 渲染
- **底层 WebGL** — 高速抗锯齿波形绘制 (GPU)
- **顶层 Canvas 2D** — 网格、光标、OSD (CPU 即时模式)

### 响应式状态
- `STATE` 为普通对象（渲染循环热路径性能优化）
- `Store` 实例可选，提供 `watch/set/batch` 订阅能力

---

## 🔧 技术栈

| 技术 | 用途 |
|---|---|
| Web Audio API | 音频输入/输出、信号发生器、频谱分析 |
| Web Serial API | 串口通信 |
| WebGL | GPU 加速波形渲染、Bloom 辉光效果 |
| Canvas 2D | 网格、光标、FFT、OSD |
| ES Module | 零构建工具的前端模块化 |
| CSS Variables | 深色/浅色/绿/琥珀多主题系统 |
| Service Worker | PWA 离线缓存 |

**零外部依赖** — 不依赖 React、Vue、Three.js 等任何第三方库。

---

## 📊 性能

- **常规运行**: 60 FPS (8 通道 + FFT + 测量全开)
- **串口模式**: 60 FPS @ 115200 bps
- **FFT**: 32768 点 Radix-2 < 1ms
- **首次加载**: 完全离线可用 (PWA 缓存后)

---

## 🤝 贡献

欢迎 Issue 和 Pull Request。项目遵循以下原则：

1. **保持零依赖** — 任何改动不应引入外部依赖
2. **向后兼容** — 不破坏现有 API 和行为
3. **性能优先** — 渲染循环是热路径，避免抽象开销

---

## 📝 许可

MIT License © 2024 wanghaohan
