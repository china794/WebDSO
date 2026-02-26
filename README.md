# WebDSO

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

WebDSO 是一款基于现代浏览器的原生数字存储示波器（DSO）。项目无任何前端构建工具和第三方依赖，底层通过 `Web Audio API` 进行信号捕获与 DSP 处理，使用 `WebGL` 实现高帧率波形渲染与荧光余辉模拟。

**在线体验（Live Demo）**：[https://wanghaohan.com/sbq.html](https://wanghaohan.com/sbq.html)

## 核心特性

### 渲染管线 (WebGL)
* **硬件加速**：使用原生 WebGL 替代 Canvas 2D，支持高密度数据点的平滑渲染。
* **自适应插值重建**：
  * **稀疏数据 (短时基)**：底层实现 Lanczos-Sinc 卷积插值算法。
  * **密集数据 (长时基)**：自动切换为峰值检波 (Peak Detect) 模式，保留高频包络。
* **X-Y 模式**：支持双通道联合 Sinc 重建的李萨如图形绘制。
* **余辉模拟**：通过自定义 Bloom Shader 实现类似模拟示波器的 CRT 电子束辉光效果。

### 信号处理与测量
* **多输入源**：支持本地无损音频解码 (WAV/FLAC)、系统声卡/麦克风捕获、以及内置离线测试源。
* **双通道 AWG**：内置任意波形发生器 (正弦波、方波、三角波)，支持跨通道频率锁定。
* **触发系统**：支持 CH1/CH2 边缘触发，内置深度迟滞 (Hysteresis) 算法以抑制高频噪声。
* **光标与参数**：提供 X/Y 轴物理游标测量，实时计算 Vpp 与频率。

## 快速运行

本项目为纯静态文件，无需 `npm install` 或构建流程：

1. 克隆本仓库。
2. 推荐使用本地服务器 (如 VS Code `Live Server` 或 Python `http.server`) 托管根目录，以避免大文件加载时的 CORS 限制。
3. 在 Chrome 或 Edge 浏览器中访问 `index.html`。
4. 或者直接访问上方的在线体验链接。

## 硬件下位机接口 (Web Serial API)

项目提供对单片机 (如 Arduino/STM32) ADC 数据的串行通信读取支持，但需严格遵守以下物理协议与安全规范。





## 鸣谢 (Acknowledgments)

本项目的核心 WebGL 渲染管线代码参考并改编自开源项目 **Oscilloscope-1.0.8**。特此感谢原作者在 Web 音频可视化底层的探索与贡献。

## 许可证

[MIT License](LICENSE)
