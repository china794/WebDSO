# WebDSO — Browser-Based Digital Storage Oscilloscope

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Demo](https://img.shields.io/badge/Demo-Online-green.svg)](https://wanghaohan.com/sbq.html)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)]()

> **A zero-install browser-based digital oscilloscope for embedded debugging and signal visualization.**

**无需安装、无需编译、打开浏览器即可使用的专业级数字示波器。**

支持声卡输入、串口采集、音频文件分析，内置 8 通道任意波形发生器，WebGL 硬件加速渲染，可覆盖大多数串口波形可视化场景。

[🚀 在线体验](https://wanghaohan.com/sbq.html)

---

<!-- TODO: 添加项目演示 GIF -->
<!-- ![WebDSO Demo](docs/demo.gif) -->

> 💡 **提示**: 项目演示 GIF 即将添加，展示 WebGL 波形渲染 + FFT 实时频谱

## ✨ 为什么选择 WebDSO？

| 特性 | WebDSO | 传统示波器软件 | 主流串口波形工具 |
|------|--------|---------------|----------------|
| **安装** | 零安装，浏览器打开即用 | 需要下载安装包 | 需要下载安装 |
| **跨平台** | Windows/Mac/Linux/ChromeOS | 依赖特定系统 | Windows/Mac |
| **串口支持** | ✅ 原生 Web Serial | ❌ 需驱动 | ✅ 支持 |
| **信号发生器** | ✅ 8通道 AWG 内置 | ❌ 需硬件 | ❌ 不支持 |
| **FFT 分析** | ✅ 实时频谱 | ⚠️ 部分支持 | ⚠️ 部分支持 |
| **体积** | < 100KB | > 50MB | ~20MB |

**核心优势：**
- 🎯 **嵌入式调试神器** - 单片机 ADC 数据实时可视化
- 📊 **信号分析工具** - 音频、传感器数据采集分析
- 🎓 **教学演示平台** - 无需昂贵设备即可学习示波器原理
- 🔧 **便携测试工具** - 任何带 Chrome 的电脑都是示波器

---

## 🎬 功能展示

### 1. 多信号源输入
- 🎤 **麦克风/线路输入** - 实时采集环境声音、电路噪声
- 🔌 **串口数据采集** - 连接 STM32/ESP32/Arduino，实时显示 ADC 数据
- 📁 **音频文件分析** - 支持 WAV/FLAC，离线信号分析
- 🎛️ **内置信号发生器** - 8 通道独立 AWG，正弦/方波/三角波

### 2. 专业级显示
- 📈 **Y-T 模式** - 传统时域波形，支持触发、光标测量
- 🔄 **X-Y 模式** - 李萨如图形，相位差分析
- 📊 **FFT 频谱分析** - 实时频谱，支持线性/对数刻度，峰值检测
- 🎯 **智能触发系统** - 边沿触发 + 自适应迟滞算法，稳定显示
- 🗺️ **波形小地图** - 全局预览 + 视窗导航
- 📏 **光标测量** - 双光标电压/时间差测量
- 📐 **自动测量** - Vmax, Vmin, Vpp, Vavg, Freq 实时测量

### 3. 8 通道独立控制
- 每通道独立开关、档位、位置、耦合方式（DC/AC）
- 独立颜色标识，清晰区分
- 批量操作：一键开启/关闭所有通道

### 4. 串口音频监听
- 🔊 **实时音频输出** - 将串口数据转换为立体声播放
- 🎚️ **双声道独立映射** - 左/右声道可独立选择通道
- 🎵 **DC Blocker** - 自动滤除直流偏置，纯交流声输出
- 🔄 **智能重采样** - 自动适配任意串口采样率到声卡

---

## 📊 性能指标

| 指标 | 数值 | 说明 |
|------|------|------|
| **最大采样率** | 96 kHz (音频) / **1.2 MHz** (串口) | 音频受限于声卡，串口压力测试稳定可达 1.2MHz |
| **串口波特率** | 最高 12 Mbps | 实测 12Mbps 稳定传输 |
| **波形缓冲深度** | 524,288 点/通道 (串口) / 32,768 点 (音频) | 支持深存储模式 |
| **FFT 点数** | 32,768 点 | 频率分辨率 ~1.46 Hz @ 48kHz |
| **WebGL 帧率** | 60 FPS | 硬件加速渲染 |
| **显示延迟** | < 16 ms | 端到端延迟 |
| **串口吞吐** | 1 MB/s @ 12Mbps | 8 通道浮点数据 |
| **通道数** | 8 通道 | 独立控制 |

**技术栈：**
- **Web Audio API** - 音频捕获、信号生成、DSP 处理
- **WebGL** - 硬件加速波形渲染、Bloom 辉光特效
- **Web Serial API** - 串口通信（Chrome/Edge）
- **View Transitions API** - 主题切换动画

---

## 🚀 30 秒快速开始

### 方式一：在线使用（推荐）

直接访问 **[https://wanghaohan.com/sbq.html](https://wanghaohan.com/sbq.html)**

无需安装，即开即用！

### 方式二：本地运行

```bash
# 1. 克隆仓库
git clone https://github.com/yourusername/WebDSO.git
cd WebDSO

# 2. 启动本地服务器
python -m http.server 3333

# 3. 浏览器访问
open http://localhost:3333
```

---

## 🛣️ 路线图 (Roadmap)

### 已完成 ✅
- [x] **摇杆式时基控制** - 左拉放大，右拉缩小，持续变化
- [x] **自动测量** - Vmax, Vmin, Vpp, Vavg, Freq 实时测量
- [x] **串口音频监听** - DC Blocker + 相位重采样
- [x] **频谱渲染优化** - 降采样 + 峰值保持
- [x] **小地图性能优化** - 降采样缓存机制

### 近期 (v1.x)
- [ ] **PWA 支持** - 离线使用，添加到桌面
- [ ] **快捷键** - 键盘快捷操作（运行/停止、切换光标等）
- [ ] **WebUSB 支持** - 直接连接 USB 示波器硬件
- [ ] **数据录制与回放** - 保存波形数据，支持时域回放
- [ ] **CSV 导出** - 导出测量数据到 Excel 分析
- [ ] **通道数学运算** - 加、减、乘、除等运算

### 中期 (v2.x)
- [ ] **WebRTC 远程波形共享** - 实时共享波形到远程端
- [ ] **插件机制** - 支持自定义协议解析器和渲染器
- [ ] **多设备同步** - 多台示波器数据同步显示
- [ ] **云端存储** - 波形配置和测量数据云同步

### 远期 (v3.x)
- [ ] **AI 辅助分析** - 自动识别信号异常、频谱特征
- [ ] **3D 波形显示** - WebGL 3D 波形瀑布图
- [ ] **硬件加速解码** - WebCodecs API 支持更多格式

---

## 🎯 应用场景

### 1. 嵌入式开发调试
```
STM32 ADC → UART → WebDSO
实时监控传感器数据、PWM 波形、电源纹波
```

### 2. 音频信号分析
```
麦克风 → Web Audio API → FFT 频谱分析
音频设备测试、噪声分析、频率响应测量
```

### 3. 教学演示
```
无需购买昂贵示波器，浏览器即可演示
信号与系统、数字信号处理课程辅助工具
```

### 4. 快速原型验证
```
Arduino 传感器项目 → 串口输出 → 实时可视化
快速验证硬件设计，无需配置复杂软件
```

---

## 🔌 串口通信

WebDSO 支持通过 Web Serial API 连接单片机，实时采集多通道 ADC 数据。

### 支持的协议

#### 1. JustFloat 协议（推荐）

二进制协议，高效率，适合高速采集。

**帧格式：**
```
[同步头 4 字节] [数据载荷 N×4 字节] [同步尾 4 字节]
```

- **同步头/尾**: `0x00 0x00 0x80 0x7F`
- **数据载荷**: N 个 IEEE-754 单精度浮点数（小端序），范围 0-3.3V

**采样率公式：**
```
采样率 = 波特率 / 120
```

**STM32 示例：**
```c
const uint8_t SYNC[4] = {0x00, 0x00, 0x80, 0x7F};
float data[8];  // 8 通道数据，范围 0-3.3V

// 发送帧
HAL_UART_Transmit(&huart1, SYNC, 4, 100);
HAL_UART_Transmit(&huart1, (uint8_t*)data, 32, 100);
HAL_UART_Transmit(&huart1, SYNC, 4, 100);
```

**Python 示例：**
```python
import serial, struct

ser = serial.Serial('COM3', 921600)
data = [1.5, 2.3, 0.8, 3.1, 1.2, 2.7, 0.5, 2.9]  # 8 通道 0-3.3V
sync = bytes([0x00, 0x00, 0x80, 0x7F])

ser.write(sync)
ser.write(struct.pack('<8f', *data))  # 小端序 8 个 float
ser.write(sync)
```

#### 2. FireWater 协议（兼容模式）

ASCII 文本协议，易于调试，兼容 vofa+。

**格式：**
```
CH1,CH2,CH3,CH4\n
或
ADC:1.234,2.345,3.456,4.567\n
```

**详细协议文档：** [docs/serial-protocol.md](./docs/serial-protocol.md)

---

### 项目结构

```
WebDSO/
├── index.html              # 主页面文件
├── styles/                 # CSS 样式文件
│   ├── layout.css         # 布局样式
│   ├── controls.css       # 控件样式
│   └── osd.css            # OSD 显示样式
├── js/                     # JavaScript 源代码
│   ├── main.js            # 程序入口
│   ├── core.js            # 全局状态、配置管理、数据缓冲池
│   ├── constants.js       # 常量定义
│   ├── channel.js         # 8 通道管理
│   ├── audio.js           # Web Audio API、信号发生器、音频捕获
│   ├── serial.js          # Web Serial API、协议解析、音频监听
│   ├── signal.js          # 触发算法、FFT、测量计算
│   ├── utils.js           # 工具函数
│   ├── reactive.js        # 响应式系统
│   ├── shaders.js         # WebGL 着色器
│   ├── controllers/       # UI 控制器
│   │   ├── inputController.js    # 输入控制（运行、触发、通道）
│   │   ├── configController.js   # 配置控制（时基、档位）
│   │   ├── audioController.js    # 音频控制（信号发生器）
│   │   ├── serialController.js   # 串口控制
│   │   ├── fftController.js      # FFT 控制
│   │   └── themeController.js    # 主题控制
│   ├── render/            # 渲染引擎
│   │   ├── index.js       # 渲染主循环
│   │   ├── webglRenderer.js  # WebGL 波形渲染
│   │   ├── canvasRenderer.js # Canvas2D 网格/波形渲染
│   │   ├── cursorRenderer.js # 光标、小地图渲染
│   │   ├── fftRenderer.js    # FFT 频谱渲染
│   │   └── gridRenderer.js   # 网格渲染
│   └── lib/               # 第三方库
│       └── fft.js         # FFT 快速傅里叶变换
└── docs/                  # 文档目录
```


---

## 🌐 浏览器兼容性

| 浏览器 | 兼容性 | 说明 |
|--------|--------|------|
| Chrome 89+ | ✅ 完美支持 | 推荐，完整功能 |
| Edge 89+ | ✅ 完美支持 | 推荐，完整功能 |
| Firefox | ⚠️ 部分支持 | 不支持串口功能 |
| Safari | ⚠️ 部分支持 | 不支持串口功能 |

**注意：**
- 麦克风输入需要 HTTPS 安全上下文
- 串口功能需要 Chrome/Edge 浏览器

---

## ⚠️ 限制说明

WebDSO 受限于浏览器环境和 Web API，以下场景**不适用**：

| 限制 | 说明 | 替代方案 |
|------|------|---------|
| **无硬件触发电路** | 软件触发，非实时 | 适用于低速信号 (< 800kHz) |
| **带宽受限** | 受限于声卡/串口 | 音频：96kHz / 串口：**1.2MHz+**@12Mbps |
| **无探头补偿** | 无硬件探头校准 | 软件校准，适合低频 |
| **MHz 级信号** | 不适用 | 请使用专业硬件示波器 |
| **串口仅 Chromium** | Firefox/Safari 不支持 | 使用 Chrome/Edge |
| **需要 HTTPS** | 麦克风需要安全上下文 | 本地运行或 HTTPS 部署 |

**适用场景：** 嵌入式调试、音频分析、教学演示、中高速信号监测（< 1.2MHz）

**不适用场景：** 高速数字信号、射频、GHz 级采样、精密测量

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/AmazingFeature`
3. 提交更改：`git commit -m 'Add some AmazingFeature'`
4. 推送分支：`git push origin feature/AmazingFeature`
5. 创建 Pull Request

### 代码规范

- 使用 ES6 Modules
- 零第三方依赖（纯原生 JavaScript）
- 注释清晰，关键算法有详细说明
- 性能优化：预分配缓冲区、降采样、循环展开
- 模块化架构：输入层、处理层、渲染层分离

---

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证

Copyright 2026 Wang Haohan

---

## 🙏 致谢

- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)

---

> ⭐ 如果这个项目对你有帮助，请给个 Star 支持一下！
