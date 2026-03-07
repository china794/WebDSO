import { DOM, Buffers, updateTriggerUI, CONFIG, STATE, initDOM } from './core.js';
import { resize, draw, initRenderContexts } from './render/index.js';
import { channelManager } from './channel.js';

// 导入所有拆分出来的 Controller
import { initThemeController } from './controllers/themeController.js';
import { initInputController, refreshVerticalCard, refreshInputCard } from './controllers/inputController.js';
import { initAudioController } from './controllers/audioController.js';
import { initSerialController } from './controllers/serialController.js';
import { initFftController } from './controllers/fftController.js';
import { initConfigController } from './controllers/configController.js';

// 初始化DOM引用 - 确保DOM已加载完成
initDOM();

// 初始化渲染上下文（WebGL/Canvas）
initRenderContexts();

// 重新收集所有的 DOM 引用（挂载所有 [id] 元素，转换为 camelCase 对象键）
// 这会补充可能遗漏的动态元素
document.querySelectorAll('[id]').forEach(el => {
    const camelCaseId = el.id.replace(/-([a-z0-9])/g, (g) => g[1].toUpperCase());
    if (!DOM[camelCaseId]) DOM[camelCaseId] = el;
});

// 绑定通道缓冲区（解决循环依赖）
channelManager.forEach((channel) => channel.bindBuffers(Buffers));

// 初始化所有控制器
initThemeController();
initInputController();
initAudioController();
initSerialController();
initFftController();
initConfigController();

// 视口监听
window.addEventListener('resize', resize);
resize();

// 恢复初始 UI 状态
if (DOM.cplChSel) DOM.cplChSel.dispatchEvent(new Event('change'));
updateTriggerUI();
refreshVerticalCard(1);
refreshInputCard(1);
// 启动渲染循环
draw();

// 串口真实采样率测量定时器 - 每500ms计算一次
setInterval(() => {
    const measurer = STATE.realSampleMeasurer;
    const now = performance.now();
    
    // 先保存当前计数，再重置，避免竞态条件
    const currentFrameCount = measurer.frameCount;
    const lastTime = measurer.lastTime;
    
    // 立即重置计数器，为下一个测量周期做准备
    measurer.frameCount = 0;
    measurer.lastTime = now;
    
    // 计算距离上次测量过去了多少秒
    const timeDiffInSeconds = (now - lastTime) / 1000;
    
    // 只在串口模式下计算和更新UI
    if (STATE.current.isSerial && timeDiffInSeconds > 0) {
        // 核心公式：真实收到的帧数 / 实际流逝的秒数
        const actualRate = Math.round(currentFrameCount / timeDiffInSeconds);
        measurer.actualRate = actualRate;
        
        let displayRate = actualRate;
        let rateStr = displayRate > 1000 ? (displayRate / 1000).toFixed(1) + 'kHz' : displayRate + 'Hz';
        
        // 如果半秒内一帧都没收到，说明断了或者卡了
        if (displayRate === 0) rateStr = '--';
        
        if (DOM.osdTimebase) {
            DOM.osdTimebase.innerText = `${STATE.secPerDiv.toFixed(1)}ms @ ${rateStr}`;
        }
    }
}, 500); // 500毫秒更新一次

/* ==========================================
   UI Initialization: Random Glass Background
   ========================================== */
function initGlassBackground() {
    // 1. 随机选择 1-5
    const randomId = Math.floor(Math.random() * 5) + 1;
    
    // 2. 构造绝对路径 (Absolute Path)
    // 原理：以当前页面 URL 为基准，往上跳一级 (../)，进入 background 文件夹
    // 假设当前是 https://wanghaohan.com/WebDSO/
    // ../background/3.jpg 会被自动解析为 https://wanghaohan.com/background/3.jpg
    const bgUrl = new URL(`./background/${randomId}.jpg`, window.location.href).href;

    // 3. 获取面板元素
    const rightPanel = document.querySelector('.right-panel');
    
    // 4. 设置 CSS 变量 (传入绝对路径)
    if (rightPanel) {
        rightPanel.style.setProperty('--panel-bg-image', `url('${bgUrl}')`);
        console.log(`WebDSO: Background loaded from ${bgUrl}`);
    }
}

// 立即执行初始化
initGlassBackground();