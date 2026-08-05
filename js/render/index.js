/**
 * ==========================================
 * Render Module Index - 渲染模块入口
 * ==========================================
 * 统一导出所有渲染器，管理渲染流�?
 */

// TODO: 导入并导出所有渲染器
// TODO: 实现主渲染流程控�?
// js/render/index.js
import { STATE, CONFIG, DOM, CACHE, CHANNEL_COUNT, Buffers } from '../core.js';
import { BUFFER, RENDER, UI, WEBGL } from '../constants.js';
import { vsSource, fsSource, vsBloom, fsBloom, vsComposite, fsComposite, vsFade, fsFade } from '../shaders.js';
import { AudioState, getCurrentTime } from '../audio.js';
import { processData, updateMeasurements } from '../signal.js';
import { SerialEngine } from '../serial.js';
import { detectQuality, getQuality } from './quality.js';

// 渲染上下�?�?从独�?context 模块导入，消除循环依�?
import {
    ctx2d, gl,
    shaderProgram,
    initRenderContext, checkResizeFBO
} from './context.js';

// 脏标记系�?
import { dirty, LAYER } from './dirty.js';

// 导入拆分的子模块
import { renderGrid } from './gridRenderer.js';
import { renderWaveforms, applyBloom } from './webglRenderer.js';
import { renderFFT } from './fftRenderer.js';
import { renderCursors, renderHover, renderTriggerLine, renderMinimap } from './cursorRenderer.js';
import { renderRefWaveform } from './refWaveRenderer.js';
import { renderPerfMonitor, startFrame, endFrame, markPhase } from './perfMonitor.js';
import { renderXYZAxes } from './xyzRenderer.js';
import { calculateTimebaseAndTrigger } from './canvasRenderer.js';

/**
 * ==========================================
 * 渲染模块 (Render Module) - 入口文件
 * ==========================================
 */

// 在渲染上下文初始化前加载着色器到全局�?context.js 使用
window.__WEBDSO_SHADERS = { vsSource, fsSource, vsBloom, fsBloom, vsComposite, fsComposite, vsFade, fsFade };

// 缓存上次的尺�?& 主题，用于检测变�?
let _lastGridConfig = { w: 0, h: 0, isLight: false };

/**
 * 初始化渲染上下文 - 应在DOM准备好后调用
 */
export function initRenderContexts() {
    // 首次初始化时检测设备性能 (自适应降级)
    detectQuality();
    return initRenderContext(DOM.oscilloscope, DOM.glCanvas);
}

/**
 * 响应窗口尺寸变化，更�?Canvas 分辨率与 DPR
 * 使用质量档位的 DPR 上限 (移动端高 DPR 手机限制像素量)
 */
export function resize() {
    const q = getQuality();
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    const wrapper = document.querySelector('.screen-wrapper');
    if (!wrapper) return;

    // 确保渲染上下文已初始�?
    if (!gl || !ctx2d) {
        if (!initRenderContexts()) return;
    }

    let w = wrapper.clientWidth;
    let h = wrapper.clientHeight;

    DOM.oscilloscope.width = w * dpr;
    DOM.oscilloscope.height = h * dpr;
    DOM.glCanvas.width = w * dpr;
    DOM.glCanvas.height = h * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!STATE.run) renderSingleFrame();
}

/** 防抖版 resize (移动端地址栏折叠连续触发时合并) */
export function resizeDebounced() {
    clearTimeout(resizeDebounced._timer);
    resizeDebounced._timer = setTimeout(resize, 200);
}

let renderLoopRunning = false;
let rafId = null;

function queueNextFrame() {
    if (!renderLoopRunning || !STATE.power || rafId !== null) return;
    rafId = requestAnimationFrame(renderLoopTick);
}

function renderLoopTick() {
    rafId = null;
    draw();

    if (renderLoopRunning && STATE.power) {
        queueNextFrame();
    } else {
        renderLoopRunning = false;
    }
}

export function startRenderLoop() {
    if (renderLoopRunning) return;
    renderLoopRunning = true;
    queueNextFrame();
}

export function stopRenderLoop() {
    renderLoopRunning = false;
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

export function renderSingleFrame(options = {}) {
    draw(options);
}
let lastTime = performance.now();
let frameCount = 0;
let fpsNode = document.createElement('div');
fpsNode.style = `position:absolute; top:${UI.FPS_NODE_TOP}px; left:${UI.FPS_NODE_LEFT}px; color:#00ff00; font-weight:bold; font-family:monospace; z-index:9999;`;
document.body.appendChild(fpsNode);

function updateFPS() {
    frameCount++;
    let now = performance.now();
    if (now - lastTime >= RENDER.FPS_UPDATE_INTERVAL) {
        fpsNode.innerText = `JS FPS: ${frameCount}`;
        frameCount = 0;
        lastTime = now;
    }
}

// ---- 数据获取与处理逻辑保留在入口文件，作为总控 ----

// 模块级复用的临时缓冲，避免每帧在热路径上分配 GC 垃圾
let _acquireTemp = null;

function acquireData() {
    // 优先使用当前活动的数据源（由STATE.current.isSerial控制�?
    if (STATE.current.isSerial && STATE.serial && STATE.serial.connected) {
        SerialEngine.fillData(Buffers.data1, Buffers.data2, Buffers.data3, Buffers.data4, Buffers.data5, Buffers.data6, Buffers.data7, Buffers.data8);
    } else if (AudioState.audioCtx && AudioState.analyser1_DC) {
        // 音频模式：使用analyser获取数据
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            const cpl = STATE['ch' + i].cpl;
            const analyser = cpl === 'AC' ? AudioState['analyser' + i + '_AC'] : AudioState['analyser' + i + '_DC'];
            if (analyser) {
                // 获取fftSize
                const fftSize = analyser.fftSize;
                // 复用模块级临时缓冲（首次按最大 fftSize 分配）
                if (!_acquireTemp || _acquireTemp.length < fftSize) {
                    _acquireTemp = new Float32Array(fftSize);
                }
                analyser.getFloatTimeDomainData(_acquireTemp.subarray(0, fftSize));
                // 复制到Buffers - 只复制前fftSize个元�?
                Buffers['data' + i].set(_acquireTemp.subarray(0, fftSize), 0);
                // 剩余部分清零
                Buffers['data' + i].fill(0, fftSize);
            }
        }
    }
}

function processDisplayChannels() {
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        processData(Buffers['data' + i], STATE['ch' + i], Buffers['pData' + i]);
    }
}

function updateAnalysisChannels(viewCtx) {
    const viewRange = viewCtx ? { startIdx: viewCtx.startIdxInt, endIdx: viewCtx.endIdxInt } : null;
    updateMeasurements(Buffers.data1, Buffers.data2, Buffers.data3, Buffers.data4, Buffers.data5, Buffers.data6, Buffers.data7, Buffers.data8, viewRange);

    if (!STATE.current.isSerial && AudioState.audioCtx) {
        const timebaseStr = STATE.secPerDiv.toFixed(1) + 'ms';
        const rate = AudioState.audioCtx.sampleRate;
        const saRateStr = rate >= 1000 ? (rate / 1000).toFixed(1) + 'kHz' : rate + 'Hz';
        const displayStr = `${timebaseStr} @ ${saRateStr}`;
        if (DOM.osdTimebase && DOM.osdTimebase.innerText !== displayStr) {
            DOM.osdTimebase.innerText = displayStr;
        }
    }
}

function updateChannelOSD() {
    const osdBoxes = [null, DOM.osdBoxCh1, DOM.osdBoxCh2, DOM.osdBoxCh3, DOM.osdBoxCh4, DOM.osdBoxCh5, DOM.osdBoxCh6, DOM.osdBoxCh7, DOM.osdBoxCh8];
    const osdScales = [null, DOM.osdCh1Scale, DOM.osdCh2Scale, DOM.osdCh3Scale, DOM.osdCh4Scale, DOM.osdCh5Scale, DOM.osdCh6Scale, DOM.osdCh7Scale, DOM.osdCh8Scale];
    const osdCpls = [null, DOM.osdCpl1, DOM.osdCpl2, DOM.osdCpl3, DOM.osdCpl4, DOM.osdCpl5, DOM.osdCpl6, DOM.osdCpl7, DOM.osdCpl8];
    
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        const box = osdBoxes[i], scaleEl = osdScales[i], cplEl = osdCpls[i];
        if (box) box.style.display = STATE['ch' + i].on ? 'flex' : 'none';
        if (STATE['ch' + i].on) {
            const vPerDiv = (1 / STATE['ch' + i].scale).toFixed(2);
            if (scaleEl) scaleEl.innerText = vPerDiv + 'V';
            if (cplEl) cplEl.innerText = STATE['ch' + i].cpl;
        }
    }
}

function updateTriggerOSD(triggerIndexFloat) {
    let curTStateTxt, curTStateBg, curTStateColor;
    if (!STATE.run) { 
        curTStateTxt = "Stop"; curTStateBg = "var(--color-stop)"; curTStateColor = "#fff"; 
    } else if (!STATE.trigger.enabled) { 
        curTStateTxt = "Free"; curTStateBg = "transparent"; curTStateColor = "var(--text-dim)"; 
    } else if (triggerIndexFloat !== -1) { 
        curTStateTxt = "Trig'd"; curTStateBg = "var(--color-green)"; curTStateColor = "#fff"; 
    } else { 
        curTStateTxt = "Auto"; curTStateBg = "var(--osd-text)"; curTStateColor = "var(--bg-panel)"; 
    }

    if (CACHE.tStateTxt !== curTStateTxt) { 
        DOM.osdTriggerState.innerText = curTStateTxt; 
        CACHE.tStateTxt = curTStateTxt; 
    }
    if (CACHE.tStateColor !== curTStateBg) { 
        DOM.osdTriggerState.style.background = curTStateBg; 
        DOM.osdTriggerState.style.color = curTStateColor;
        CACHE.tStateColor = curTStateBg; 
    }
}

function updateAudioSeekbar() {
    if (AudioState.isSeeking) return;
    let cur, dur;
    if (AudioState.streamingMode && AudioState.audioElement) {
        // <audio> 流式降级模式
        cur = AudioState.audioElement.currentTime || 0;
        dur = AudioState.audioElement.duration;
        if (!isFinite(dur) || dur <= 0) return;
    } else if (AudioState.audioBuffer) {
        cur = getCurrentTime(); dur = AudioState.audioBuffer.duration;
    } else {
        return;
    }
    let newVal = (cur / dur) * 100;
    let timeStr = `${new Date(cur * 1000).toISOString().substring(14, 19)} / ${new Date(dur * 1000).toISOString().substring(14, 19)}`;
    if (Math.abs(CACHE.audioSeekVal - newVal) > 0.1) { DOM.audioSeekBar.value = newVal; CACHE.audioSeekVal = newVal; }
    if (CACHE.audioTimeStr !== timeStr) { DOM.lblAudioTime.innerText = timeStr; CACHE.audioTimeStr = timeStr; }
}

/** =========================================
 * 主渲染循�?
 * 每帧全量渲染——Canvas 2D 即时模式 + WebGL 保留模式
 * ========================================= */
export function draw({ processPausedData = false } = {}) {
    startFrame();
    updateFPS();

    if (!DOM.glCanvas || DOM.glCanvas.width <= 0 || DOM.glCanvas.height <= 0) return;

    // 确保渲染上下文已初始�?
    if (!gl || !ctx2d) {
        if (!initRenderContexts()) return;
    }

    const theme = CONFIG.colors;
    const isLight = document.body.getAttribute('data-theme') === 'light';

    // 尺寸变化时重新分�?FBO
    checkResizeFBO(DOM.glCanvas.width, DOM.glCanvas.height);

    // WebGL 混合模式
    gl.blendFunc(gl.ONE, isLight ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
    gl.useProgram(shaderProgram);

    const dpr = window.devicePixelRatio || WEBGL.DEFAULT_DPR;
    const w = DOM.oscilloscope.width / dpr;
    const h = DOM.oscilloscope.height / dpr;
    const stepY = h / CONFIG.gridY;
    const stepX = stepY;
    CONFIG.gridX = w / stepX;

    // ==== Canvas 2D 层（即时模式——每帧清�?全量重绘�?===
    ctx2d.clearRect(0, 0, w, h);
    const renderGridOn = !STATE.render || STATE.render.grid !== false;
    if (renderGridOn && STATE.mode === 'XY') {
        let ac = 0;
        for (let i = 1; i <= 8; i++) if (STATE['ch' + i]?.on) ac++;
        if (ac >= 3) {
            // XYZ 模式：不画网格，只透明白背�?
            ctx2d.fillStyle = 'transparent';
        } else {
            renderGrid(w, h, stepX, stepY, theme);
        }
    } else if (renderGridOn) {
        renderGrid(w, h, stepX, stepY, theme);
    }

    // ==== 数据获取 & 处理 ====
    if (STATE.run) {
        acquireData();
    }
    markPhase('dataAcq');

    if (STATE.run || processPausedData) {
        processDisplayChannels();
    }

    const viewCtx = calculateTimebaseAndTrigger(w);

    if (STATE.run || processPausedData) {
        updateAnalysisChannels(viewCtx);
    }
    markPhase('process');

    // ==== Canvas 2D 叠加层（每帧重绘�?===
    updateTriggerOSD(viewCtx.triggerIndexFloat);
    const overlaysOn = !STATE.render || STATE.render.overlays !== false;
    if (overlaysOn) {
        renderTriggerLine(w, h, theme, viewCtx);
        renderHover(w, h, stepX, theme, viewCtx);
    }
    renderCursors(w, h, theme);
    renderRefWaveform(w, h, theme, viewCtx);
    markPhase('canvas2d');

    // ==== WebGL 波形（每帧重绘——内部自�?gl.clear�?===
    renderWaveforms(theme, isLight, viewCtx);
    // 辉光叠加 (可选, 低档位自动关闭)
    const q = getQuality();
    if (STATE.render && STATE.render.glow && q.glow) {
        applyBloom();
    }
    markPhase('webgl');

    // ==== 小地�?====
    if (!STATE.render || STATE.render.minimap !== false) {
        renderMinimap(theme, viewCtx);
    }

    // ==== DOM 更新 ====
    updateChannelOSD();
    updateAudioSeekbar();

    // ==== FFT 频谱 ====
    if (STATE.fft && STATE.fft.on) {
        renderFFT(w, h, theme, isLight);
    }

    // XYZ 3D 坐标轴（仅在 XY 模式�?3 频道激活时�?
    if (STATE.mode === 'XY') {
        let activeCnt = 0;
        for (let i = 1; i <= 8; i++) if (STATE['ch' + i]?.on) activeCnt++;
        if (activeCnt >= 3) renderXYZAxes(w, h, theme);
    }

    endFrame();
    renderPerfMonitor(w, h);
}