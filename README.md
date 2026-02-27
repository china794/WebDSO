# WebDSO

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

WebDSO 是一款基于现代浏览器的原生数字存储示波器（DSO）。项目无任何前端构建工具和第三方依赖，底层通过 `Web Audio API` 进行信号捕获与 DSP 处理，使用 `WebGL` 实现高帧率波形渲染与荧光余辉模拟。

**在线体验（Live Demo）**：[https://wanghaohan.com/WebDSO](https://wanghaohan.com/WebDSO)

## 快速运行

本项目为纯静态文件，无需 `npm install` 或构建流程：

1. 克隆本仓库。
2. 推荐使用本地服务器 (如 VS Code `Live Server` 或 Python `http.server`) 托管根目录，以避免大文件加载时的 CORS 限制。
3. 在 Chrome 或 Edge 浏览器中访问 `index.html`。
4. 或者直接访问上方的在线体验链接。



## 鸣谢 (Acknowledgments)

本项目的核心 WebGL 渲染管线代码参考并改编自开源项目 **Oscilloscope-1.0.8**。特此感谢原作者在 Web 音频可视化底层的探索与贡献。

## 许可证

[MIT License](LICENSE)
