import { STATE, CONFIG, XY_PTS, ALPHA_LUT, GL_CONST, DOM, CACHE, Buffers, CHANNEL_COUNT } from './core.js';
import { vsSource, fsSource, vsBloom, fsBloom } from './shaders.js';
import { AudioState, getCurrentTime } from './audio.js';
import { findTriggerIndex, processData, updateMeasurements } from './signal.js';
import { SerialEngine } from './serial.js';

/**
 * ==========================================
 * 渲染模块 (Render Module)
 * ==========================================
 * 负责：
 * - WebGL 波形绘制（抗锯齿、辉光后期）
 * - Canvas 2D 背景网格、十字标尺、触发线
 * - 小地图、FFT 频谱、光标、悬停信息
 */

const ctx2d = DOM.oscilloscope.getContext('2d', { alpha: true });
const gl = DOM.glCanvas.getContext('webgl', { 
    alpha: false, 
    antialias: true, 
    premultipliedAlpha: false 
});

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

const shaderProgram = gl.createProgram();
gl.attachShader(shaderProgram, createShader(gl, gl.VERTEX_SHADER, vsSource));
gl.attachShader(shaderProgram, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(shaderProgram);

const bloomProgram = gl.createProgram();
gl.attachShader(bloomProgram, createShader(gl, gl.VERTEX_SHADER, vsBloom));
gl.attachShader(bloomProgram, createShader(gl, gl.FRAGMENT_SHADER, fsBloom));
gl.linkProgram(bloomProgram);

const posAttr = gl.getAttribLocation(shaderProgram, 'a_position');
const dataAttr = gl.getAttribLocation(shaderProgram, 'a_data');
const colorUni = gl.getUniformLocation(shaderProgram, 'u_color');
const sizeUni = gl.getUniformLocation(shaderProgram, 'u_size');
const intensityUni = gl.getUniformLocation(shaderProgram, 'u_intensity');

const posAttrBloom = gl.getAttribLocation(bloomProgram, 'a_pos');
const texUniBloom = gl.getUniformLocation(bloomProgram, 'u_texture');
const texSizeUniBloom = gl.getUniformLocation(bloomProgram, 'u_texSize');

const vbo = gl.createBuffer();
const glDataArray = new Float32Array(CONFIG.fftSize * 30);
const quadVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]), gl.STATIC_DRAW);

let fbo = gl.createFramebuffer();
let fboTexture = gl.createTexture();
let currentFboWidth = 0;
let currentFboHeight = 0;

/** 调整离屏渲染目标 (FBO) 尺寸，用于 Bloom 后期处理 */
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
fpsNode.style = "position:absolute; top:10px; left:10px; color:#00ff00; font-weight:bold; font-family:monospace; z-index:9999;";
document.body.appendChild(fpsNode);

/**
 * 主渲染循环：数据采集 → 处理 → 绘制波形 → 叠加 UI
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

    if (DOM.glCanvas.width <= 0 || DOM.glCanvas.height <= 0) return;

    // 获取当前主题和颜色体系
    const theme = CONFIG.colors;
    const isLight = document.body.getAttribute('data-theme') === 'light';

    if (DOM.glCanvas.width !== currentFboWidth || DOM.glCanvas.height !== currentFboHeight) {
        currentFboWidth = DOM.glCanvas.width;
        currentFboHeight = DOM.glCanvas.height;
        resizeFBO(currentFboWidth, currentFboHeight);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, currentFboWidth, currentFboHeight);
    
    // 动态切换 WebGL 屏幕底色和混合模式
    gl.clearColor(theme.bg[0], theme.bg[1], theme.bg[2], theme.bg[3]);
    gl.blendFunc(gl.ONE, isLight ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
    
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(shaderProgram);

    const w = DOM.oscilloscope.width / (window.devicePixelRatio || 1);
    const h = DOM.oscilloscope.height / (window.devicePixelRatio || 1);
    const stepY = h / CONFIG.gridY;
    const stepX = stepY; 
    CONFIG.gridX = w / stepX;

    ctx2d.clearRect(0, 0, w, h);
    ctx2d.save();
    ctx2d.translate(0.5, 0.5);
    
    // 背景网格线颜色
    ctx2d.strokeStyle = theme.grid;
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    
    for (let x = w / 2 + stepX; x < w; x += stepX) { ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); }
    for (let x = w / 2 - stepX; x > 0; x -= stepX) { ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); }
    for (let i = 1; i < CONFIG.gridY; i++) { ctx2d.moveTo(0, i * stepY); ctx2d.lineTo(w, i * stepY); }
    ctx2d.stroke();

    // 中心高亮十字标尺颜色
    ctx2d.strokeStyle = theme.crosshair;
    ctx2d.beginPath();
    ctx2d.moveTo(w / 2, 0); ctx2d.lineTo(w / 2, h);
    ctx2d.moveTo(0, h / 2); ctx2d.lineTo(w, h / 2);

    for (let x = w / 2 + stepX / 5; x < w; x += stepX / 5) { ctx2d.moveTo(x, h / 2 - 3); ctx2d.lineTo(x, h / 2 + 3); }
    for (let x = w / 2 - stepX / 5; x > 0; x -= stepX / 5) { ctx2d.moveTo(x, h / 2 - 3); ctx2d.lineTo(x, h / 2 + 3); }
    for (let y = h / 2 + stepY / 5; y < h; y += stepY / 5) { ctx2d.moveTo(w / 2 - 3, y); ctx2d.lineTo(w / 2 + 3, y); }
    for (let y = h / 2 - stepY / 5; y > 0; y -= stepY / 5) { ctx2d.moveTo(w / 2 - 3, y); ctx2d.lineTo(w / 2 + 3, y); }
    ctx2d.stroke();
    ctx2d.restore();

    if (STATE.run) {
        if (STATE.serial && STATE.serial.connected) {
            SerialEngine.fillData(Buffers.data1, Buffers.data2, Buffers.data3, Buffers.data4, Buffers.data5, Buffers.data6, Buffers.data7, Buffers.data8);
        } else if (AudioState.audioCtx && AudioState.analyser1_DC) {
            for (let i = 1; i <= CHANNEL_COUNT; i++) {
                const cpl = STATE['ch' + i].cpl;
                const analyser = cpl === 'AC' ? AudioState['analyser' + i + '_AC'] : AudioState['analyser' + i + '_DC'];
                if (analyser) analyser.getFloatTimeDomainData(Buffers['data' + i]);
            }
        }
    }

    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        processData(Buffers['data' + i], STATE['ch' + i], Buffers['pData' + i]);
    }
    updateMeasurements(Buffers.data1, Buffers.data2, Buffers.data3, Buffers.data4, Buffers.data5, Buffers.data6, Buffers.data7, Buffers.data8);

    let currentRate = STATE.current.sampleRate;
    
    const saRateStr = (currentRate >= 1000) ? (currentRate / 1000).toFixed(1) + 'kSa/s' : currentRate + 'Sa/s';
    if (DOM.osdSamplerate.innerText !== saRateStr) DOM.osdSamplerate.innerText = saRateStr;

    let ptsPerDiv = (STATE.secPerDiv) * (currentRate / 1000); 
    let ptsToShow = Math.floor(ptsPerDiv * CONFIG.gridX);

    const trigCh = parseInt(STATE.trigger.src.replace('CH', '')) || 1;
    let trigData = Buffers['pData' + trigCh];
    let tScale = STATE['ch' + trigCh].scale;
    let tPos = STATE['ch' + trigCh].pos;
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
    let viewCenterIdx = anchorIdx + (STATE.hpos / 100 - 0.5) * CONFIG.fftSize;
    let startIdxFloat = viewCenterIdx - ptsToShow / 2;
    let startIdxInt = Math.floor(startIdxFloat);
    let endIdxInt = Math.ceil(startIdxFloat + ptsToShow) + 1;

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

    if (STATE.mode === 'YT' && STATE.trigger.enabled) {
        ctx2d.strokeStyle = theme.trigger;
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
        
        // 恢复小地图发光叠加模式
        mCtx.globalCompositeOperation = 'lighter'; 

        /** 在小地图上绘制单通道波形 (min-max 压缩) */
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
        
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            if (STATE['ch' + i].on) drawMiniTrace(Buffers['pData' + i], theme['miniTrace' + i]);
        }
        
        mCtx.globalCompositeOperation = 'source-over'; 

        let leftP = (startIdxFloat / CONFIG.fftSize) * 100;
        let widthP = (ptsToShow / CONFIG.fftSize) * 100;
        let highlight = document.getElementById('minimap-highlight');
        if (highlight) { highlight.style.left = leftP + '%'; highlight.style.width = widthP + '%'; }
    }

    /** 使用 WebGL 绘制单条波形轨迹 (Y-T 或 X-Y 模式) */
    const renderGLTrace = (dataBuffer, colorArr, isXY, pData2_XY) => {
        let aspect = DOM.glCanvas.height / DOM.glCanvas.width;
        let vIdx = 0, pointCount = 0;
        
        let uSize = isLight ? 0.002 : ((STATE.current && STATE.current.lineSize) ? STATE.current.lineSize : 0.002);
        let uIntensity = (isLight || (STATE.current && STATE.current.isSerial)) ? 2 : 1;

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

    if (STATE.mode === 'YT') {
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            if (STATE['ch' + i].on) renderGLTrace(Buffers['pData' + i], theme['c' + i], false);
        }
    } else if (STATE.mode === 'XY') {
        renderGLTrace(Buffers.pData1, theme.cXY, true, Buffers.pData2);
    }

    // OSD 右侧：仅显示开启的频道，并更新档位/耦合
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        const box = document.getElementById('osd-box-ch' + i);
        const scaleEl = document.getElementById('osd-ch' + i + '-scale');
        const cplEl = document.getElementById('osd-cpl' + i);
        if (box) box.style.display = STATE['ch' + i].on ? 'flex' : 'none';
        if (STATE['ch' + i].on) {
            const vPerDiv = (1 / STATE['ch' + i].scale).toFixed(2);
            if (scaleEl) scaleEl.innerText = vPerDiv + 'V';
            if (cplEl) cplEl.innerText = STATE['ch' + i].cpl;
        }
    }

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

    if (AudioState.audioBuffer && !AudioState.isSeeking) {
        let cur = getCurrentTime(); let dur = AudioState.audioBuffer.duration;
        let newVal = (cur / dur) * 100;
        let timeStr = `${new Date(cur * 1000).toISOString().substring(14, 19)} / ${new Date(dur * 1000).toISOString().substring(14, 19)}`;
        if (Math.abs(CACHE.audioSeekVal - newVal) > 0.1) { DOM.audioSeekBar.value = newVal; CACHE.audioSeekVal = newVal; }
        if (CACHE.audioTimeStr !== timeStr) { DOM.lblAudioTime.innerText = timeStr; CACHE.audioTimeStr = timeStr; }
    }

    if (STATE.fft && STATE.fft.on) {
        const hasFftBuffer = Array.from({ length: CHANNEL_COUNT }, (_, i) => STATE.fft['buffer' + (i + 1)]).some(Boolean);
        if (!hasFftBuffer) return; 

        const currentRate = STATE.current.sampleRate; 
        let maxFreq = STATE.fft.maxFreq || 8000;
        let gain = STATE.fft.gain || 100;
        let isLog = STATE.fft.logScale; 

        let numBins = STATE.fft.buffer1.length; 
        let N = numBins * 2; 
        const minFreq = 20; 

        ctx2d.save();
        ctx2d.fillStyle = theme.fftBg; 
        ctx2d.fillRect(0, h - 150, w, 150);
        
        /** 绘制单通道 FFT 频谱柱状图 */
        const drawSpectrum = (buffer, color, offsetX) => {
            ctx2d.beginPath();
            ctx2d.strokeStyle = color; 
            ctx2d.lineWidth = 1.5;
            let started = false;
            for (let i = 0; i < numBins; i++) {
                let freq = i * (currentRate / N);
                if (freq > maxFreq) break; 
                
                let x = 0;
                if (isLog) {
                    if (freq < minFreq) continue; 
                    let logCur = Math.log10(freq);
                    let logMin = Math.log10(minFreq);
                    let logMax = Math.log10(maxFreq);
                    x = ((logCur - logMin) / (logMax - logMin)) * w;
                } else {
                    x = (freq / maxFreq) * w; 
                }
                
                let magnitude = buffer[i] * gain; 
                let barHeight = Math.min(145, magnitude);
                let y = h - barHeight;
                x += offsetX; 
                
                if (!started) { ctx2d.moveTo(x, y); started = true; } 
                else { ctx2d.lineTo(x, y); }
            }
            ctx2d.stroke();
        };

        
        ctx2d.globalCompositeOperation = isLight ? 'source-over' : 'screen'; 
        
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            if (STATE['ch' + i].on && STATE.fft['buffer' + i]) {
                drawSpectrum(STATE.fft['buffer' + i], theme['fftC' + i], i - 1);
            }
        }
        
        ctx2d.globalCompositeOperation = 'source-over';; 

        ctx2d.fillStyle = theme.fftTextDim; 
        ctx2d.font = '10px monospace';
        ctx2d.textAlign = 'center';
        
        if (isLog) {
            let marks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
            for (let m of marks) {
                if (m > maxFreq || m < minFreq) continue;
                let lx = ((Math.log10(m) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq))) * w;
                ctx2d.fillText(m >= 1000 ? (m/1000)+'k' : m, lx, h - 5);
                ctx2d.fillStyle = theme.fftTextDim;
                ctx2d.globalAlpha = 0.1;
                ctx2d.fillRect(lx, h - 150, 1, 140);
                ctx2d.globalAlpha = 1.0;
            }
        } else {
            let steps = 6;
            for (let i = 0; i <= steps; i++) {
                let f = (maxFreq / steps) * i;
                let lx = (f / maxFreq) * w;
                if (lx < 15) lx = 15; 
                if (lx > w - 15) lx = w - 15;
                ctx2d.fillText(f >= 1000 ? (f/1000).toFixed(1)+'k' : Math.round(f), lx, h - 5);
                ctx2d.fillStyle = theme.fftTextDim;
                ctx2d.globalAlpha = 0.1;
                ctx2d.fillRect(lx, h - 150, 1, 140);
                ctx2d.globalAlpha = 1.0;
            }
        }
        
        ctx2d.textAlign = 'left';
        ctx2d.fillStyle = theme.fftTextBright; 
        ctx2d.fillText(`FFT | Span: ${maxFreq}Hz | Gain: x${gain} | ${isLog ? 'LOG' : 'LIN'}`, 10, h - 135);
        ctx2d.restore();
    }

    if (STATE.cursor && STATE.cursor.mode > 0) {
        ctx2d.save(); 
        ctx2d.translate(0.5, 0.5); 
        ctx2d.lineWidth = 1;
        if (STATE.cursor.mode === 1) {
            let y1 = h / 2 - STATE.cursor.v1 * (h / 2);
            let y2 = h / 2 - STATE.cursor.v2 * (h / 2);
            ctx2d.strokeStyle = theme.cursorY;
            ctx2d.setLineDash([4, 4]); 
            ctx2d.beginPath(); ctx2d.moveTo(0, y1); ctx2d.lineTo(w, y1); ctx2d.stroke();
            ctx2d.beginPath(); ctx2d.moveTo(0, y2); ctx2d.lineTo(w, y2); ctx2d.stroke();
            const ndcVPD = 2.0 / CONFIG.gridY;
            const dvVals = Array.from({ length: CHANNEL_COUNT }, (_, i) => 
                STATE['ch' + (i + 1)].on ? Math.abs(STATE.cursor.v1 - STATE.cursor.v2) / ndcVPD * (1 / STATE['ch' + (i + 1)].scale) : null);
            
            ctx2d.fillStyle = theme.hoverBg; 
            ctx2d.fillRect(10, 40, 180, Math.max(50, 20 + dvVals.filter(Boolean).length * 18)); 
            ctx2d.strokeStyle = theme.hoverBorder; 
            ctx2d.setLineDash([]);
            ctx2d.strokeRect(10, 40, 180, Math.max(50, 20 + dvVals.filter(Boolean).length * 18)); 
            
            ctx2d.font = 'bold 11px Courier New'; 
            let dy = 58;
            for (let i = 0; i < CHANNEL_COUNT; i++) {
                if (dvVals[i] != null) {
                    ctx2d.fillStyle = theme['c' + (i + 1) + 'Hex'];
                    ctx2d.fillText(`ΔCH${i + 1}: ${dvVals[i].toFixed(2)} V`, 20, dy);
                    dy += 18;
                }
            }
        } else if (STATE.cursor.mode === 2) {
            let x1 = w / 2 + STATE.cursor.t1 * (w / 2);
            let x2 = w / 2 + STATE.cursor.t2 * (w / 2);
            ctx2d.strokeStyle = theme.cursorX;
            ctx2d.setLineDash([4, 4]); 
            ctx2d.beginPath(); ctx2d.moveTo(x1, 0); ctx2d.lineTo(x1, h); ctx2d.stroke();
            ctx2d.beginPath(); ctx2d.moveTo(x2, 0); ctx2d.lineTo(x2, h); ctx2d.stroke();
            let dt = Math.abs(STATE.cursor.t1 - STATE.cursor.t2) / (2.0 / CONFIG.gridX) * STATE.secPerDiv;
            let f = dt > 0 ? 1000 / dt : 0;
            
            ctx2d.fillStyle = theme.hoverBg; 
            ctx2d.fillRect(10, 40, 160, 50); 
            ctx2d.strokeStyle = theme.hoverBorder; 
            ctx2d.setLineDash([]);
            ctx2d.strokeRect(10, 40, 160, 50); 
            
            ctx2d.fillStyle = theme.cursorX; 
            ctx2d.font = 'bold 12px Courier New'; 
            ctx2d.fillText(`ΔT : ${dt.toFixed(2)} ms`, 20, 60); 
            ctx2d.fillText(`1/ΔT: ${f.toFixed(1)} Hz`, 20, 80);
        }
        ctx2d.restore();
    }

    if (STATE.hover && STATE.hover.active && STATE.mode === 'YT') {
        ctx2d.save();
        ctx2d.strokeStyle = theme.fftTextDim;
        ctx2d.lineWidth = 1; ctx2d.setLineDash([4, 4]);
        ctx2d.beginPath(); 
        ctx2d.moveTo(STATE.hover.x, 0); ctx2d.lineTo(STATE.hover.x, h); 
        ctx2d.moveTo(0, STATE.hover.y); ctx2d.lineTo(w, STATE.hover.y); 
        ctx2d.stroke();
        
        let tx = ((anchorIdx - startIdxFloat) / ptsToShow) * w;
        let gX = (STATE.hover.x - tx) / stepX; 
        let tD = gX * STATE.secPerDiv;
        let vNDC = (h / 2 - STATE.hover.y) / (h / 2); 
        let ndcVPD = 2.0 / CONFIG.gridY;
        const vVals = Array.from({ length: CHANNEL_COUNT }, (_, i) => 
            STATE['ch' + (i + 1)].on ? (vNDC - STATE['ch' + (i + 1)].pos) / (STATE['ch' + (i + 1)].scale * ndcVPD) : null);
        const activeCount = vVals.filter(Boolean).length;
        let bW = 140, bH = Math.max(65, 20 + activeCount * 18);
        let tX = STATE.hover.x + 15, tY = STATE.hover.y + 15;
        
        if (tX + bW > w) tX = STATE.hover.x - bW - 10; 
        if (tY + bH > h) tY = STATE.hover.y - bH - 10;
        
        ctx2d.fillStyle = theme.hoverBg; 
        ctx2d.fillRect(tX, tY, bW, bH); 
        ctx2d.strokeStyle = theme.hoverBorder; 
        ctx2d.setLineDash([]); 
        ctx2d.strokeRect(tX, tY, bW, bH);
        
        ctx2d.font = 'bold 12px Courier New'; 
        ctx2d.fillStyle = theme.hoverText; 
        ctx2d.fillText(` T: ${tD > 0 ? '+' : ''}${tD.toFixed(3)} ms`, tX + 10, tY + 20);
        let vy = tY + 38;
        for (let i = 0; i < CHANNEL_COUNT; i++) {
            if (vVals[i] != null) {
                ctx2d.fillStyle = theme['c' + (i + 1) + 'Hex'];
                ctx2d.fillText(`C${i + 1}: ${vVals[i].toFixed(3)} V`, tX + 10, vy);
                vy += 18;
            }
        }
        ctx2d.restore();
    }
}