/**
 * ==========================================
 * Render Module Index - 渲染模块入口
 * ==========================================
 * 统一导出所有渲染器，管理渲染流程
 */

// TODO: 导入并导出所有渲染器
// TODO: 实现主渲染流程控制
// js/render/index.js
import { STATE, CONFIG, DOM, CACHE, CHANNEL_COUNT, Buffers } from '../core.js';
import { BUFFER, RENDER, UI, WEBGL } from '../constants.js';
import { vsSource, fsSource, vsBloom, fsBloom } from '../shaders.js';
import { AudioState, getCurrentTime } from '../audio.js';
import { processData, updateMeasurements } from '../signal.js';
import { SerialEngine } from '../serial.js';

// 导入拆分的子模块
import { renderGrid } from './gridRenderer.js';
import { renderWaveforms, applyBloom } from './webglRenderer.js';
import { renderFFT } from './fftRenderer.js';
import { renderCursors, renderHover, renderTriggerLine, renderMinimap } from './cursorRenderer.js';
import { calculateTimebaseAndTrigger } from './canvasRenderer.js';

/**
 * ==========================================
 * 渲染模块 (Render Module) - 入口文件
 * ==========================================
 */

export const ctx2d = DOM.oscilloscope?.getContext('2d', { alpha: true });
export const gl = DOM.glCanvas?.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false });

if (!ctx2d || !gl) console.error('Failed to get canvas context');

/** 编译单个着色器并返回句柄，失败时输出错误日志 */
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        return null;
    }
    return shader;
}

export const shaderProgram = gl.createProgram();
gl.attachShader(shaderProgram, createShader(gl, gl.VERTEX_SHADER, vsSource));
gl.attachShader(shaderProgram, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(shaderProgram);

export const bloomProgram = gl.createProgram();
gl.attachShader(bloomProgram, createShader(gl, gl.VERTEX_SHADER, vsBloom));
gl.attachShader(bloomProgram, createShader(gl, gl.FRAGMENT_SHADER, fsBloom));
gl.linkProgram(bloomProgram);

export const posAttrBloom = gl.getAttribLocation(bloomProgram, 'a_pos');
export const texUniBloom = gl.getUniformLocation(bloomProgram, 'u_texture');
export const texSizeUniBloom = gl.getUniformLocation(bloomProgram, 'u_texSize');

export const quadVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
gl.bufferData(gl.ARRAY_BUFFER, WEBGL.FULLSCREEN_QUAD, gl.STATIC_DRAW);

export let fbo = gl.createFramebuffer();
export let fboTexture = gl.createTexture();
export let currentFboWidth = 0;
export let currentFboHeight = 0;

/** 调整离屏渲染目标 (FBO) 尺寸，用于 Bloom 后期处理 */
export function resizeFBO(w, h) {
    gl.bindTexture(gl.TEXTURE_2D, fboTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

gl.enable(gl.BLEND);

/**
 * 响应窗口尺寸变化，更新 Canvas 分辨率与 DPR
 */
export function resize() {
    const dpr = window.devicePixelRatio || 1;
    const wrapper = document.querySelector('.screen-wrapper');
    if (!wrapper) return;

    let w = wrapper.clientWidth;
    let h = wrapper.clientHeight;

    DOM.oscilloscope.width = w * dpr;
    DOM.oscilloscope.height = h * dpr;
    DOM.glCanvas.width = w * dpr;
    DOM.glCanvas.height = h * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!STATE.run) draw();
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

function acquireData() {
    // 优先使用当前活动的数据源（由STATE.current.isSerial控制）
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
                // 创建一个临时缓冲区获取数据
                const tempBuffer = new Float32Array(fftSize);
                analyser.getFloatTimeDomainData(tempBuffer);
                // 复制到Buffers - 只复制前fftSize个元素
                Buffers['data' + i].set(tempBuffer, 0);
                // 剩余部分清零
                Buffers['data' + i].fill(0, fftSize);
            }
        }
    }
}

function processChannels(viewCtx) {
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        processData(Buffers['data' + i], STATE['ch' + i], Buffers['pData' + i]);
    }
    // 传入当前视角范围，使测量只针对可见波形
    // 注意：使用data（原始数据）进行测量，对于串口模式这是实际电压值（0-3.3V）
    const viewRange = viewCtx ? { startIdx: viewCtx.startIdxInt, endIdx: viewCtx.endIdxInt } : null;
    updateMeasurements(Buffers.data1, Buffers.data2, Buffers.data3, Buffers.data4, Buffers.data5, Buffers.data6, Buffers.data7, Buffers.data8, viewRange);
    
    // 音频模式：直接显示 Web Audio API 的采样率
    if (!STATE.current.isSerial && AudioState.audioCtx) {
        const timebaseStr = STATE.secPerDiv.toFixed(1) + 'ms';
        const rate = AudioState.audioCtx.sampleRate;
        const saRateStr = rate >= 1000 ? (rate / 1000).toFixed(1) + 'kHz' : rate + 'Hz';
        const displayStr = `${timebaseStr} @ ${saRateStr}`;
        if (DOM.osdTimebase && DOM.osdTimebase.innerText !== displayStr) {
            DOM.osdTimebase.innerText = displayStr;
        }
    }
    // 串口模式的采样率由定时器每500ms更新，不在这里处理
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
    if (AudioState.audioBuffer && !AudioState.isSeeking) {
        let cur = getCurrentTime(); let dur = AudioState.audioBuffer.duration;
        let newVal = (cur / dur) * 100;
        let timeStr = `${new Date(cur * 1000).toISOString().substring(14, 19)} / ${new Date(dur * 1000).toISOString().substring(14, 19)}`;
        if (Math.abs(CACHE.audioSeekVal - newVal) > 0.1) { DOM.audioSeekBar.value = newVal; CACHE.audioSeekVal = newVal; }
        if (CACHE.audioTimeStr !== timeStr) { DOM.lblAudioTime.innerText = timeStr; CACHE.audioTimeStr = timeStr; }
    }
}

/** =========================================
 * 主渲染循环
 * ========================================= */
export function draw() {
    updateFPS();
    
    if (STATE.power) requestAnimationFrame(draw);
    if (DOM.glCanvas.width <= 0 || DOM.glCanvas.height <= 0) return;

    const theme = CONFIG.colors;
    const isLight = document.body.getAttribute('data-theme') === 'light';
    
    // 这部分由于需要 fbo 等变量，暂时写在这里，等 webglRenderer 拆分后再移入
    if (DOM.glCanvas.width !== currentFboWidth || DOM.glCanvas.height !== currentFboHeight) {
        currentFboWidth = DOM.glCanvas.width;
        currentFboHeight = DOM.glCanvas.height;
        resizeFBO(currentFboWidth, currentFboHeight);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, currentFboWidth, currentFboHeight);
    gl.clearColor(theme.bg[0], theme.bg[1], theme.bg[2], theme.bg[3]);
    gl.blendFunc(gl.ONE, isLight ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(shaderProgram);

    const dpr = window.devicePixelRatio || WEBGL.DEFAULT_DPR;
    const w = DOM.oscilloscope.width / dpr;
    const h = DOM.oscilloscope.height / dpr;
    const stepY = h / CONFIG.gridY;
    const stepX = stepY;
    CONFIG.gridX = w / stepX;

    ctx2d.clearRect(0, 0, w, h);
    
    const renderCtx = { w, h, stepX, stepY };

    // 调用分离的渲染函数
    renderGrid(renderCtx.w, renderCtx.h, renderCtx.stepX, renderCtx.stepY, theme);

    if (STATE.run) acquireData();

    const viewCtx = calculateTimebaseAndTrigger(renderCtx.w);
    
    // 处理通道数据，传入当前视角范围用于测量
    processChannels(viewCtx);

    updateTriggerOSD(viewCtx.triggerIndexFloat);

    renderTriggerLine(renderCtx.w, renderCtx.h, theme, viewCtx);
    renderMinimap(theme, viewCtx);

    renderWaveforms(theme, isLight, viewCtx);
    // 串口模式不使用辉光效果，直接绘制到屏幕
    if (!STATE.current.isSerial) {
        applyBloom();
    }

    updateChannelOSD();
    updateAudioSeekbar();

    renderFFT(renderCtx.w, renderCtx.h, theme, isLight);
    renderCursors(renderCtx.w, renderCtx.h, theme);
    renderHover(renderCtx.w, renderCtx.h, renderCtx.stepX, theme, viewCtx);
}