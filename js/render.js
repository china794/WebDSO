import { STATE, CONFIG, XY_PTS, ALPHA_LUT, GL_CONST, DOM, CACHE, Buffers } from './core.js';
import { vsSource, fsSource, vsBloom, fsBloom } from './shaders.js';
import { AudioState, getCurrentTime } from './audio.js';
import { findTriggerIndex, processData, updateMeasurements } from './signal.js';
import { SerialEngine } from './serial.js';

/**
 * 渲染模块：负责 WebGL 波形绘制、Canvas 2D 背景网格及 UI 叠加层渲染
 */

// 初始化绘图上下文
const ctx2d = DOM.oscilloscope.getContext('2d', { alpha: true });
const gl = DOM.glCanvas.getContext('webgl', { 
    alpha: false, 
    antialias: true, 
    premultipliedAlpha: false 
});

// --- WebGL 程序初始化 ---

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

// 主波形程序
const shaderProgram = gl.createProgram();
gl.attachShader(shaderProgram, createShader(gl, gl.VERTEX_SHADER, vsSource));
gl.attachShader(shaderProgram, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(shaderProgram);

// 辉光(Bloom)后期处理程序
const bloomProgram = gl.createProgram();
gl.attachShader(bloomProgram, createShader(gl, gl.VERTEX_SHADER, vsBloom));
gl.attachShader(bloomProgram, createShader(gl, gl.FRAGMENT_SHADER, fsBloom));
gl.linkProgram(bloomProgram);

// 获取着色器变量位置
const posAttr = gl.getAttribLocation(shaderProgram, 'a_position');
const dataAttr = gl.getAttribLocation(shaderProgram, 'a_data');
const colorUni = gl.getUniformLocation(shaderProgram, 'u_color');
const sizeUni = gl.getUniformLocation(shaderProgram, 'u_size');
const intensityUni = gl.getUniformLocation(shaderProgram, 'u_intensity');

const posAttrBloom = gl.getAttribLocation(bloomProgram, 'a_pos');
const texUniBloom = gl.getUniformLocation(bloomProgram, 'u_texture');
const texSizeUniBloom = gl.getUniformLocation(bloomProgram, 'u_texSize');

// 初始化缓冲区
const vbo = gl.createBuffer();
const glDataArray = new Float32Array(CONFIG.fftSize * 30);
const quadVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]), gl.STATIC_DRAW);

// FBO 帧缓冲区设置
let fbo = gl.createFramebuffer();
let fboTexture = gl.createTexture();
let currentFboWidth = 0;
let currentFboHeight = 0;

function resizeFBO(w, h) {
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
gl.blendFunc(gl.ONE, gl.ONE);

/**
 * 处理窗口或容器尺寸变化
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

// 性能监测与帧率统计
let lastTime = performance.now();
let frameCount = 0;
let fpsNode = document.createElement('div');
fpsNode.style = "position:absolute; top:10px; left:10px; color:#00ff00; font-weight:bold; font-family:monospace; z-index:9999;";
document.body.appendChild(fpsNode);

/**
 * 主渲染循环
 */
export function draw() {
    frameCount++;
    let now = performance.now();
    if (now - lastTime >= 1000) {
        fpsNode.innerText = `JS FPS: ${frameCount}`;
        frameCount = 0;
        lastTime = now;
    }

    if (STATE.power) requestAnimationFrame(draw);

    // 1. 安全拦截：防止长宽为 0 导致 WebGL 报错
    if (DOM.glCanvas.width <= 0 || DOM.glCanvas.height <= 0) return;

    // 2. 检查并更新 FBO 尺寸
    if (DOM.glCanvas.width !== currentFboWidth || DOM.glCanvas.height !== currentFboHeight) {
        currentFboWidth = DOM.glCanvas.width;
        currentFboHeight = DOM.glCanvas.height;
        resizeFBO(currentFboWidth, currentFboHeight);
    }

    // 3. WebGL 环境准备
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, currentFboWidth, currentFboHeight);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(shaderProgram);

    // 4. 2D 背景网格计算与绘制
    const w = DOM.oscilloscope.width / (window.devicePixelRatio || 1);
    const h = DOM.oscilloscope.height / (window.devicePixelRatio || 1);
    const stepY = h / CONFIG.gridY;
    const stepX = stepY; // 保持正方形格子
    CONFIG.gridX = w / stepX;

    ctx2d.clearRect(0, 0, w, h);
    ctx2d.save();
    ctx2d.translate(0.5, 0.5);
    ctx2d.strokeStyle = '#1e2920';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    
    // 绘制垂直线
    for (let x = w / 2 + stepX; x < w; x += stepX) { ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); }
    for (let x = w / 2 - stepX; x > 0; x -= stepX) { ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); }
    // 绘制水平线
    for (let i = 1; i < CONFIG.gridY; i++) { ctx2d.moveTo(0, i * stepY); ctx2d.lineTo(w, i * stepY); }
    ctx2d.stroke();

    // 绘制中心高亮十字准星
    ctx2d.strokeStyle = '#2d4a30';
    ctx2d.beginPath();
    ctx2d.moveTo(w / 2, 0); ctx2d.lineTo(w / 2, h);
    ctx2d.moveTo(0, h / 2); ctx2d.lineTo(w, h / 2);

    // 绘制中心刻度
    for (let x = w / 2 + stepX / 5; x < w; x += stepX / 5) { ctx2d.moveTo(x, h / 2 - 3); ctx2d.lineTo(x, h / 2 + 3); }
    for (let x = w / 2 - stepX / 5; x > 0; x -= stepX / 5) { ctx2d.moveTo(x, h / 2 - 3); ctx2d.lineTo(x, h / 2 + 3); }
    for (let y = h / 2 + stepY / 5; y < h; y += stepY / 5) { ctx2d.moveTo(w / 2 - 3, y); ctx2d.lineTo(w / 2 + 3, y); }
    for (let y = h / 2 - stepY / 5; y > 0; y -= stepY / 5) { ctx2d.moveTo(w / 2 - 3, y); ctx2d.lineTo(w / 2 + 3, y); }
    ctx2d.stroke();
    ctx2d.restore();

    // 5. 数据采集与协议分流逻辑
    if (STATE.run) {
        if (STATE.serial && STATE.serial.connected) {
            // 串口模式：从串口引擎提取数据
            SerialEngine.fillData(Buffers.dataL, Buffers.dataR);
        } else if (AudioState.audioCtx && AudioState.analyserL_DC) {
            // 音频模式：根据耦合方式读取数据
            if (STATE.ch1.cpl === 'AC') AudioState.analyserL_AC.getFloatTimeDomainData(Buffers.dataL);
            else AudioState.analyserL_DC.getFloatTimeDomainData(Buffers.dataL);
            
            if (STATE.ch2.cpl === 'AC') AudioState.analyserR_AC.getFloatTimeDomainData(Buffers.dataR);
            else AudioState.analyserR_DC.getFloatTimeDomainData(Buffers.dataR);
        }
    }

    // 6. 信号归一化与参数测量
    processData(Buffers.dataL, STATE.ch1, Buffers.pData1);
    processData(Buffers.dataR, STATE.ch2, Buffers.pData2);
    updateMeasurements(Buffers.dataL, Buffers.dataR);

    let currentRate = STATE.current.sampleRate;
    
    const saRateStr = (currentRate >= 1000) ? (currentRate / 1000).toFixed(1) + 'kSa/s' : currentRate + 'Sa/s';
    if (DOM.osdSamplerate.innerText !== saRateStr) DOM.osdSamplerate.innerText = saRateStr;

    let ptsPerDiv = (STATE.secPerDiv) * (currentRate / 1000); 
    let ptsToShow = Math.floor(ptsPerDiv * CONFIG.gridX);

    // 8. 触发器(Trigger)同步逻辑
    let trigData = STATE.trigger.src === 'CH1' ? Buffers.pData1 : Buffers.pData2;
    let tScale = STATE.trigger.src === 'CH1' ? STATE.ch1.scale : STATE.ch2.scale;
    let tPos = STATE.trigger.src === 'CH1' ? STATE.ch1.pos : STATE.ch2.pos;
    const ndcPerDiv = 2.0 / CONFIG.gridY;
    let mappedLevel = STATE.trigger.level * tScale * ndcPerDiv + tPos;

    if (STATE.trigger.enabled) {
        if (!window._frozenTriggerIdx || STATE.run) {
            window._frozenTriggerIdx = findTriggerIndex(trigData, ptsToShow, 0, mappedLevel);
        }
    } else {
        window._frozenTriggerIdx = -1;
    }

    let triggerIndexFloat = window._frozenTriggerIdx;
    let anchorIdx = triggerIndexFloat !== -1 ? triggerIndexFloat : CONFIG.fftSize / 2;
    // 根据 H-POS 百分比计算视口中心位置
    let viewCenterIdx = anchorIdx + (STATE.hpos / 100 - 0.5) * CONFIG.fftSize;
    let startIdxFloat = viewCenterIdx - ptsToShow / 2;
    let startIdxInt = Math.floor(startIdxFloat);
    let endIdxInt = Math.ceil(startIdxFloat + ptsToShow) + 1;

    // 更新 OSD 触发状态文字
    let curTStateTxt, curTStateColor;
    if (!STATE.run) { curTStateTxt = "Stop"; curTStateColor = "#ef4444"; }
    else if (!STATE.trigger.enabled) { curTStateTxt = "Free"; curTStateColor = "#9ca3af"; }
    else if (triggerIndexFloat !== -1) { curTStateTxt = "Trig'd"; curTStateColor = "#4ade80"; }
    else { curTStateTxt = "Auto"; curTStateColor = "#eab308"; }

    if (CACHE.tStateTxt !== curTStateTxt) { DOM.osdTriggerState.innerText = curTStateTxt; CACHE.tStateTxt = curTStateTxt; }
    if (CACHE.tStateColor !== curTStateColor) { DOM.osdTriggerState.style.color = curTStateColor; CACHE.tStateColor = curTStateColor; }

    // 在 2D 层绘制触发线和触发点标记
    if (STATE.mode === 'YT' && STATE.trigger.enabled) {
        ctx2d.strokeStyle = 'rgba(255, 165, 0, 0.4)';
        ctx2d.setLineDash([4, 4]);
        ctx2d.beginPath();
        let ty = h / 2 - mappedLevel * (h / 2);
        ctx2d.moveTo(0, ty); ctx2d.lineTo(w, ty);
        ctx2d.stroke();
        if (triggerIndexFloat !== -1) {
            let tx = ((triggerIndexFloat - startIdxFloat) / ptsToShow) * w;
            if (tx >= 0 && tx <= w) { ctx2d.beginPath(); ctx2d.moveTo(tx, 0); ctx2d.lineTo(tx, h); ctx2d.stroke(); }
        }
        ctx2d.setLineDash([]);
    }

    // 9. Minimap 缩略图与观察窗绘制
    const minimapCanvas = document.getElementById('minimap-canvas');
    if (minimapCanvas) {
        if (minimapCanvas.width === 0 || minimapCanvas.width !== minimapCanvas.clientWidth) {
            minimapCanvas.width = minimapCanvas.clientWidth;
            minimapCanvas.height = minimapCanvas.clientHeight;
        }
        const mCtx = minimapCanvas.getContext('2d');
        const mW = minimapCanvas.width;
        const mH = minimapCanvas.height;
        mCtx.clearRect(0, 0, mW, mH);
        mCtx.lineWidth = 1;
        mCtx.globalCompositeOperation = 'lighter';

        const drawMiniTrace = (data, color) => {
            mCtx.strokeStyle = color;
            mCtx.beginPath();
            let step = CONFIG.fftSize / mW;
            let started = false;
            for (let x = 0; x < mW; x++) {
                let start = Math.floor(x * step), end = Math.floor((x + 1) * step);
                let min = 999, max = -999;
                for (let j = start; j < end; j++) {
                    let v = data[j]; if (v < min) min = v; if (v > max) max = v;
                }
                if (min !== 999) {
                    let yB = mH / 2 - min * (mH / 2), yT = mH / 2 - max * (mH / 2);
                    if (!started) { mCtx.moveTo(x, yB); started = true; }
                    mCtx.lineTo(x, yB); mCtx.lineTo(x, yT);
                }
            }
            mCtx.stroke();
        };
        if (STATE.ch1.on) drawMiniTrace(Buffers.pData1, 'rgba(234,179,8,0.8)');
        if (STATE.ch2.on) drawMiniTrace(Buffers.pData2, 'rgba(6,182,212,0.8)');
        mCtx.globalCompositeOperation = 'source-over';

        // 更新高亮框位置
        let leftP = (startIdxFloat / CONFIG.fftSize) * 100;
        let widthP = (ptsToShow / CONFIG.fftSize) * 100;
        let highlight = document.getElementById('minimap-highlight');
        if (highlight) { highlight.style.left = leftP + '%'; highlight.style.width = widthP + '%'; }
    }

    // 10. WebGL 轨迹渲染核心
    // js/render.js 内部的渲染函数
/**
     * WebGL 轨迹渲染核心函数
     */
    const renderGLTrace = (dataBuffer, colorArr, isXY, pData2_XY) => {
        let aspect = DOM.glCanvas.height / DOM.glCanvas.width;
        let vIdx = 0, pointCount = 0;
        
        // 🚀 核心优化：动态读取中枢参数
        // 串口模式下线宽会加粗 (0.006)，亮度强度提高 (0.9) 以大幅降低速度衰减感
        let uSize = (STATE.current && STATE.current.lineSize) ? STATE.current.lineSize : 0.002;
        let uIntensity = (STATE.current && STATE.current.isSerial) ? 1.5 : 0.4;

        const pushV = (vx, vy, lx, ly, len) => {
            glDataArray[vIdx++] = vx; glDataArray[vIdx++] = vy;
            glDataArray[vIdx++] = lx; glDataArray[vIdx++] = ly;
            glDataArray[vIdx++] = len; pointCount++;
        };

        const addPt = (p0x, p0y, p1x, p1y) => {
            let dx = p1x - p0x, dy = p1y - p0y, z = Math.sqrt(dx * dx + dy * dy);
            let dX = (z > 1E-6 ? dx / z : 1.0) * uSize, dY = (z > 1E-6 ? dy / z : 0.0) * uSize;
            let nX = -dY, nY = dX;
            pushV(p0x - dX - nX, p0y - dY - nY, -uSize, -uSize, z);
            pushV(p0x - dX + nX, p0y - dY + nY, -uSize, uSize, z);
            pushV(p1x + dX - nX, p1y + dY - nY, z + uSize, -uSize, z);
            pushV(p0x - dX + nX, p0y - dY + nY, -uSize, uSize, z);
            pushV(p1x + dX - nX, p1y + dY - nY, z + uSize, -uSize, z);
            pushV(p1x + dX + nX, p1y + dY + nY, z + uSize, uSize, z);
        };

        if (!isXY) {
            for (let i = startIdxInt; i < endIdxInt - 1; i++) {
                let i0 = Math.max(0, Math.min(CONFIG.fftSize - 1, i));
                let i1 = Math.max(0, Math.min(CONFIG.fftSize - 1, i + 1));
                addPt(((i - startIdxFloat) / ptsToShow) * 2.0 - 1.0, dataBuffer[i0],
                      ((i + 1 - startIdxFloat) / ptsToShow) * 2.0 - 1.0, dataBuffer[i1]);
            }
        } else {
            let sIdx = Math.max(0, CONFIG.fftSize - XY_PTS - 1);
            for (let i = 1; i < XY_PTS - 1; i++) {
                if (ALPHA_LUT[i] < 0.02) continue;
                addPt(dataBuffer[sIdx+i] * aspect, pData2_XY[sIdx+i],
                      dataBuffer[sIdx+i+1] * aspect, pData2_XY[sIdx+i+1]);
            }
        }

        if (pointCount > 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, glDataArray.subarray(0, vIdx), gl.STREAM_DRAW);
            gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, GL_CONST.BYTES_PER_VERTEX, GL_CONST.POS_OFFSET);
            gl.enableVertexAttribArray(posAttr);
            gl.vertexAttribPointer(dataAttr, 3, gl.FLOAT, false, GL_CONST.BYTES_PER_VERTEX, GL_CONST.DATA_OFFSET);
            gl.enableVertexAttribArray(dataAttr);
            gl.uniform1f(sizeUni, uSize); 
            gl.uniform1f(intensityUni, uIntensity); 
            gl.uniform3fv(colorUni, colorArr);
            gl.drawArrays(gl.TRIANGLES, 0, pointCount);
        }
    };

    // 渲染通道内容
    if (STATE.mode === 'YT') {
        if (STATE.ch1.on) renderGLTrace(Buffers.pData1, CONFIG.c1, false);
        if (STATE.ch2.on) renderGLTrace(Buffers.pData2, CONFIG.c2, false);
        if (STATE.math.on) {
            for (let i = 0; i < Buffers.dataMath.length; i++) Buffers.dataMath[i] = Buffers.pData1[i] + Buffers.pData2[i];
            renderGLTrace(Buffers.dataMath, CONFIG.cM, false);
        }
    } else if (STATE.mode === 'XY') {
        renderGLTrace(Buffers.pData1, [0.1, 1.0, 0.2], true, Buffers.pData2);
    }

    // 11. 辉光(Bloom) 后期效果叠加
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, currentFboWidth, currentFboHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(bloomProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(posAttrBloom);
    gl.vertexAttribPointer(posAttrBloom, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(texSizeUniBloom, currentFboWidth, currentFboHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboTexture);
    gl.uniform1i(texUniBloom, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 12. 绘制测量光标 (Cursors)
    if (STATE.cursor.mode > 0) {
        ctx2d.save(); ctx2d.translate(0.5, 0.5); ctx2d.fillStyle = 'rgba(0, 0, 0, 0.75)'; ctx2d.lineWidth = 1;
        if (STATE.cursor.mode === 1) {
            let y1 = h / 2 - STATE.cursor.v1 * (h / 2), y2 = h / 2 - STATE.cursor.v2 * (h / 2);
            ctx2d.strokeStyle = '#a855f7'; ctx2d.setLineDash([4, 4]); ctx2d.beginPath();
            ctx2d.moveTo(0, y1); ctx2d.lineTo(w, y1); ctx2d.stroke();
            ctx2d.beginPath(); ctx2d.moveTo(0, y2); ctx2d.lineTo(w, y2); ctx2d.stroke();
            let dv1 = Math.abs(STATE.cursor.v1 - STATE.cursor.v2) / (2.0 / CONFIG.gridY) * (1 / STATE.ch1.scale);
            let dv2 = Math.abs(STATE.cursor.v1 - STATE.cursor.v2) / (2.0 / CONFIG.gridY) * (1 / STATE.ch2.scale);
            ctx2d.fillRect(10, 40, 140, 50); ctx2d.strokeStyle = '#444'; ctx2d.strokeRect(10, 40, 140, 50); ctx2d.fillStyle = '#a855f7';
            ctx2d.font = 'bold 12px Courier New'; ctx2d.fillText(`ΔCH1: ${dv1.toFixed(2)} V`, 20, 60); ctx2d.fillText(`ΔCH2: ${dv2.toFixed(2)} V`, 20, 80);
        } else if (STATE.cursor.mode === 2) {
            let x1 = w / 2 + STATE.cursor.t1 * (w / 2), x2 = w / 2 + STATE.cursor.t2 * (w / 2);
            ctx2d.strokeStyle = '#38bdf8'; ctx2d.setLineDash([4, 4]); ctx2d.beginPath();
            ctx2d.moveTo(x1, 0); ctx2d.lineTo(x1, h); ctx2d.stroke();
            ctx2d.beginPath(); ctx2d.moveTo(x2, 0); ctx2d.lineTo(x2, h); ctx2d.stroke();
            let dt = Math.abs(STATE.cursor.t1 - STATE.cursor.t2) / (2.0 / CONFIG.gridX) * STATE.secPerDiv;
            let f = dt > 0 ? 1000 / dt : 0;
            ctx2d.fillRect(10, 40, 160, 50); ctx2d.strokeStyle = '#444'; ctx2d.strokeRect(10, 40, 160, 50); ctx2d.fillStyle = '#38bdf8';
            ctx2d.font = 'bold 12px Courier New'; ctx2d.fillText(`ΔT : ${dt.toFixed(2)} ms`, 20, 60); ctx2d.fillText(`1/ΔT: ${f.toFixed(1)} Hz`, 20, 80);
        }
        ctx2d.restore();
    }

    // 13. 动态悬浮十字光标面板
    if (STATE.hover && STATE.hover.active && STATE.mode === 'YT') {
        ctx2d.save();
        ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx2d.lineWidth = 1; ctx2d.setLineDash([4, 4]);
        ctx2d.beginPath(); ctx2d.moveTo(STATE.hover.x, 0); ctx2d.lineTo(STATE.hover.x, h); ctx2d.moveTo(0, STATE.hover.y); ctx2d.lineTo(w, STATE.hover.y); ctx2d.stroke();
        let tx = ((anchorIdx - startIdxFloat) / ptsToShow) * w;
        let gX = (STATE.hover.x - tx) / stepX; let tD = gX * STATE.secPerDiv;
        let vNDC = (h / 2 - STATE.hover.y) / (h / 2); let ndcVPD = 2.0 / CONFIG.gridY;
        let v1 = (vNDC - STATE.ch1.pos) / (STATE.ch1.scale * ndcVPD); let v2 = (vNDC - STATE.ch2.pos) / (STATE.ch2.scale * ndcVPD);
        let bW = 140, bH = 65, tX = STATE.hover.x + 15, tY = STATE.hover.y + 15;
        if (tX + bW > w) tX = STATE.hover.x - bW - 10; if (tY + bH > h) tY = STATE.hover.y - bH - 10;
        ctx2d.fillStyle = 'rgba(10, 10, 12, 0.85)'; ctx2d.fillRect(tX, tY, bW, bH); ctx2d.strokeStyle = '#333'; ctx2d.setLineDash([]); ctx2d.strokeRect(tX, tY, bW, bH);
        ctx2d.font = 'bold 12px Courier New'; ctx2d.fillStyle = '#fff'; ctx2d.fillText(` T: ${tD > 0 ? '+' : ''}${tD.toFixed(3)} ms`, tX + 10, tY + 20);
        if (STATE.ch1.on) { ctx2d.fillStyle = '#eab308'; ctx2d.fillText(`C1: ${v1.toFixed(3)} V`, tX + 10, tY + 38); }
        if (STATE.ch2.on) { ctx2d.fillStyle = '#06b6d4'; ctx2d.fillText(`C2: ${v2.toFixed(3)} V`, tX + 10, tY + 56); }
        ctx2d.restore();
    }

    // 14. 音频进度条 UI 更新
    if (AudioState.audioBuffer && !AudioState.isSeeking) {
        let cur = getCurrentTime(); let dur = AudioState.audioBuffer.duration;
        let newVal = (cur / dur) * 100;
        let timeStr = `${new Date(cur * 1000).toISOString().substring(14, 19)} / ${new Date(dur * 1000).toISOString().substring(14, 19)}`;
        if (Math.abs(CACHE.audioSeekVal - newVal) > 0.1) { DOM.audioSeekBar.value = newVal; CACHE.audioSeekVal = newVal; }
        if (CACHE.audioTimeStr !== timeStr) { DOM.lblAudioTime.innerText = timeStr; CACHE.audioTimeStr = timeStr; }
    }

    // 15. FFT 频谱分析绘制逻辑
    if (STATE.fft && STATE.fft.on) {
    const currentRate = STATE.current.sampleRate; 
    
    // 🚀 读取用户设置的最大频率和增益
    let maxFreq = STATE.fft.maxFreq || 8000;
    let gain = STATE.fft.gain || 100;

    // 🚀 动态计算需要绘制多少个 Bin
    // 公式：需要的点数 = (目标最大频率 / 采样率) * FFT总长度
    let binCount = Math.floor((maxFreq / currentRate) * CONFIG.fftSize);
    
    // 防溢出保护
    binCount = Math.max(10, Math.min(binCount, STATE.fft.buffer.length));
    const barWidth = w / binCount;

    ctx2d.save();
    ctx2d.fillStyle = 'rgba(0, 40, 0, 0.5)'; // 加深背景色
    ctx2d.fillRect(0, h - 150, w, 150);
    
    ctx2d.beginPath();
    ctx2d.strokeStyle = '#4ade80'; 
    ctx2d.lineWidth = 2;

    for (let i = 0; i < binCount; i++) {
        let freq = (i * currentRate) / CONFIG.fftSize;
        
        // 🚀 动态增益放大微弱信号
        let magnitude = STATE.fft.buffer[i] * gain; 
        let barHeight = Math.min(145, magnitude); // 封顶高度
        
        let x = i * barWidth;
        let y = h - barHeight;

        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
        
        // 根据当前的 binCount 动态决定多久画一次刻度文字
        if (i % (Math.floor(binCount / 6) || 1) === 0) {
            ctx2d.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx2d.font = '10px monospace';
            ctx2d.fillText(`${(freq).toFixed(0)}Hz`, x + 2, h - 5);
            
        }
    }
    ctx2d.stroke();
    
    ctx2d.fillStyle = '#4ade80';
    ctx2d.fillText(`FFT SPECTRUM | Span: ${maxFreq}Hz | Gain: x${gain}`, 10, h - 135);
    ctx2d.restore();
}
} 