/**
 * ==========================================
 * WebGL Renderer - WebGL 波形渲染器
 * ==========================================
 * 负责使用 WebGL 渲染波形数据
 */

import { STATE, CONFIG, XY_PTS, ALPHA_LUT, GL_CONST, DOM, CHANNEL_COUNT, Buffers } from '../core.js';
import { BUFFER, WEBGL, COLOR } from '../constants.js';
import { getQuality, getEffectiveDpr } from './quality.js';
import {
    gl,
    shaderProgram,
    bloomProgram,
    fbo,
    fboTexture,
    currentFboWidth,
    currentFboHeight,
    quadVBO,
    posAttrBloom,
    texUniBloom,
    texSizeUniBloom,
    compositeProgram,
    posAttrComposite,
    texUniComposite,
    tonemapUniComposite,
    gainUniComposite,
    fadeProgram,
    posAttrFade,
    colorUniFade,
    fboHDR,
    getPhosphorDecay
} from './context.js';
import { projectXYZ } from './xyzRenderer.js';

let posAttr, dataAttr, depthAttr, colorUni, sizeUni, intensityUni, densityAlphaUni, gainUni, depthFadeUni;
let vbo;
let glDepthVBO;
let glDataArray;
let glDepthArray;
// 余辉 FBO 是否已初始化 (首帧清一次基线)
let _fboInitialized = false;

// 注册给 context.js 的 restore 回调使用（避免循环依赖）
window.__WEBDSO_RESET_WEBGL = () => resetWebGLVars();

/** 初始化 WebGL 变量 */
function initWebGLVars() {
    if (posAttr !== undefined) return;
    if (!gl || !shaderProgram) return;

    posAttr = gl.getAttribLocation(shaderProgram, 'a_position');
    dataAttr = gl.getAttribLocation(shaderProgram, 'a_data');
    depthAttr = gl.getAttribLocation(shaderProgram, 'a_depth');
    colorUni = gl.getUniformLocation(shaderProgram, 'u_color');
    sizeUni = gl.getUniformLocation(shaderProgram, 'u_size');
    intensityUni = gl.getUniformLocation(shaderProgram, 'u_intensity');
    densityAlphaUni = gl.getUniformLocation(shaderProgram, 'u_densityAlpha');
    gainUni = gl.getUniformLocation(shaderProgram, 'u_gain');
    depthFadeUni = gl.getUniformLocation(shaderProgram, 'u_depthFade');

    vbo = gl.createBuffer();
    glDataArray = new Float32Array(CONFIG.fftSize * BUFFER.VERTEX_MULTIPLIER);
    // 深度缓冲与顶点一一对应 (每个顶点 1 个 float)
    glDepthArray = new Float32Array(CONFIG.fftSize * BUFFER.VERTEX_MULTIPLIER);
}

/**
 * 重置 WebGL 缓存变量（在 webglcontextrestored 时调用）。
 * context 恢复后 attrib location / VBO 在新 context 上失效，
 * 必须清空守卫让 initWebGLVars 重新绑定。
 */
export function resetWebGLVars() {
    posAttr = dataAttr = depthAttr = colorUni = sizeUni = intensityUni = densityAlphaUni = gainUni = depthFadeUni = undefined;
    vbo = undefined;
    glDepthVBO = undefined;
    glDataArray = undefined;
    glDepthArray = undefined;
    _fboInitialized = false;
}

/**
 * 使用 WebGL 绘制单条波形轨迹 (Y-T 或 X-Y 模式)
 * @param {Float32Array} dataBuffer - 数据源
 * @param {Array} colorArr - RGB 颜色数组 [r,g,b]
 * @param {boolean} isXY - 是否为 XY/XYZ 模式
 * @param {Float32Array|null} pData2_XY - XY 模式下的 Y 通道数据
 * @param {Object} theme - 主题颜色
 * @param {boolean} isLight - 是否浅色主题
 * @param {Object|null} viewCtx - Y-T 模式下的视角上下文
 * @param {number|null} customLength - 3D XYZ 模式：自定义数据长度（从索引 0 开始）
 *  */
export function renderGLTrace(dataBuffer, colorArr, isXY, pData2_XY, theme, isLight, viewCtx, customLength, customAlphas, customDepth) {
    if (!gl) return;
    // 着色器/VBO 未就绪时跳过，避免对未定义 glDataArray 写入崩溃
    if (!shaderProgram || posAttr === undefined || !glDataArray) return;
    initWebGLVars();

    let aspect = DOM.glCanvas.height / DOM.glCanvas.width;
    let vIdx = 0, pointCount = 0;

    const isSerial = STATE.current && STATE.current.isSerial;
    let uSize = isLight ? 0.002 : ((STATE.current && STATE.current.lineSize) ? STATE.current.lineSize : 0.002);
    let uIntensity = isXY ? 1.0 : 2.0;
    const densityAlpha = 1.0;

    const pushV = (vx, vy, lx, ly, len, depth) => {
        glDataArray[vIdx++] = vx; glDataArray[vIdx++] = vy;
        glDataArray[vIdx++] = lx; glDataArray[vIdx++] = ly;
        glDataArray[vIdx++] = len;
        // 深度: 每个顶点对应一个深度值 (default 0 = 不衰减)
        glDepthArray[vIdx - 5] = depth || 0;
        pointCount++;
    };

    const addPt = (p0x, p0y, p1x, p1y, depth) => {
        let dx = p1x - p0x, dy = p1y - p0y, z = Math.sqrt(dx * dx + dy * dy);
        let dX = (z > 1E-6 ? dx / z : 1.0) * uSize, dY = (z > 1E-6 ? dy / z : 0.0) * uSize;
        let nX = -dY, nY = dX;
        pushV(p0x - dX - nX, p0y - dY - nY, -uSize, -uSize, z, depth);
        pushV(p0x - dX + nX, p0y - dY + nY, -uSize, uSize, z, depth);
        pushV(p1x + dX - nX, p1y + dY - nY, z + uSize, -uSize, z, depth);
        pushV(p0x - dX + nX, p0y - dY + nY, -uSize, uSize, z, depth);
        pushV(p1x + dX - nX, p1y + dY - nY, z + uSize, -uSize, z, depth);
        pushV(p1x + dX + nX, p1y + dY + nY, z + uSize, uSize, z, depth);
    };

    if (!isXY) {
        // ==== Y-T 模式：不变 ====
        let loopStart = Math.max(viewCtx.startIdxInt, 0);
        const bufferSize = STATE.current.isSerial ? BUFFER.SERIAL_FFT_SIZE : CONFIG.fftSize;
        let loopEnd = Math.min(viewCtx.endIdxInt - 1, bufferSize - 1);

        const canvasWidth = gl.canvas.width / getEffectiveDpr();
        // 自适应: 低档位减少渲染点数
        const q = getQuality();
        const maxRenderPoints = Math.min(Math.ceil(canvasWidth * 2), q.maxRenderPoints);
        const totalPoints = loopEnd - loopStart;
        let step = 1;
        if (totalPoints > maxRenderPoints) step = Math.ceil(totalPoints / maxRenderPoints);

        if (step > 1) {
            for (let i = loopStart; i < loopEnd; i += step) {
                const endIdx = Math.min(i + step, loopEnd);
                let maxVal = dataBuffer[i];
                let minVal = maxVal;
                for (let j = i + 1; j < endIdx; j++) {
                    const val = dataBuffer[j];
                    if (val > maxVal) maxVal = val;
                    if (val < minVal) minVal = val;
                }
                const x = ((i - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * 2.0 - 1.0;
                const x2 = ((endIdx - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * 2.0 - 1.0;
                addPt(x, minVal, x, maxVal);
                if (x2 > x) addPt(x, maxVal, x2, (dataBuffer[endIdx] + dataBuffer[endIdx - 1]) / 2);
            }
        } else {
            for (let i = loopStart; i < loopEnd; i++) {
                addPt(((i - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * 2.0 - 1.0, dataBuffer[i],
                      ((i + 1 - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * 2.0 - 1.0, dataBuffer[i+1]);
            }
        }
    } else if (customLength !== undefined && customLength > 0) {
        // ==== 3D XYZ：直接渲染投影数据，不使用 ALPHA_LUT 索引 ====
        // 因为投影数据在 buffer 中的位置索引与 ALPHA_LUT 不完全匹配
        const len = customLength;
        const yData = pData2_XY;
        // 直接从索引0开始绘制，不用 sIdx 偏移
        // 用 len 内的位置生成透明度：与 ALPHA_LUT 等价的 pow(i/len, 30)
        // 这样不受固定缓冲区位置的限制
        for (let i = 1; i < len - 1; i++) {
            const a = Math.pow(i / len, 26);
            if (a < COLOR.MIN_ALPHA) continue;
            // 深度感知: 传 customDepth 数组 (投影深度), 由 shader 做远近衰减
            const d0 = customDepth ? customDepth[i] : 0;
            const d1 = customDepth ? customDepth[i + 1] : 0;
            const depth = Math.max(d0, d1);
            addPt(dataBuffer[i] * aspect, yData ? yData[i] : 0,
                  dataBuffer[i + 1] * aspect, yData ? yData[i + 1] : 0, depth);
        }
    } else {
        // ==== 标准 2D XY 模式（去重 + Catmull-Rom 样条插值） ====
        // bytebeat 等信号源有 12:1 样本保持，保持段内相邻点重合 → 显示为光点。
        // 方案：去重冗余重合点，再用 Catmull-Rom 样条插值恢复连续平滑轨迹。
        let sIdx = Math.max(0, CONFIG.fftSize - XY_PTS - 1);

        // 1. 收集 XY 数据点（x 已乘 aspect 到屏幕坐标）
        const ptsX = [], ptsY = [];
        for (let i = 1; i < XY_PTS - 1; i++) {
            if (ALPHA_LUT[i] < COLOR.MIN_ALPHA) continue;
            ptsX.push(dataBuffer[sIdx + i] * aspect);
            ptsY.push(pData2_XY[sIdx + i]);
        }
        if (ptsX.length < 2) return;

        // 2. 去重：只保留真正不同的点（欧氏距离 > eps），消除保持段冗余重合点
        const DEDUP_EPS = 1e-4;
        const cx = [ptsX[0]], cy = [ptsY[0]];
        for (let i = 1; i < ptsX.length; i++) {
            const dx = ptsX[i] - cx[cx.length - 1];
            const dy = ptsY[i] - cy[cy.length - 1];
            if (Math.hypot(dx, dy) > DEDUP_EPS) {
                cx.push(ptsX[i]);
                cy.push(ptsY[i]);
            }
        }
        if (cx.length < 2) return;

        // 3. Catmull-Rom 样条插值：相邻去重点间细分，轨迹平滑且经过所有真点
        const MAX_STEP = 0.008;   // 插值步长（NDC），越小越平滑
        const n = cx.length;
        // 每段 [P[i], P[i+1]] 用 P[i-1] 和 P[i+2] 作控制点
        for (let i = 0; i < n - 1; i++) {
            const p0x = cx[Math.max(0, i - 1)], p0y = cy[Math.max(0, i - 1)];
            const p1x = cx[i], p1y = cy[i];
            const p2x = cx[i + 1], p2y = cy[i + 1];
            const p3x = cx[Math.min(n - 1, i + 2)], p3y = cy[Math.min(n - 1, i + 2)];

            const segLen = Math.hypot(p2x - p1x, p2y - p1y);
            const steps = Math.max(2, Math.round(segLen / MAX_STEP));

            let prevX = p1x, prevY = p1y;
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const t2 = t * t, t3 = t2 * t;
                // Catmull-Rom 基函数
                const x = 0.5 * (
                    (2 * p1x) +
                    (-p0x + p2x) * t +
                    (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2 +
                    (-p0x + 3 * p1x - 3 * p2x + p3x) * t3
                );
                const y = 0.5 * (
                    (2 * p1y) +
                    (-p0y + p2y) * t +
                    (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2 +
                    (-p0y + 3 * p1y - 3 * p2y + p3y) * t3
                );
                addPt(prevX, prevY, x, y);
                prevX = x; prevY = y;
            }
        }
    }

    if (pointCount > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, glDataArray.subarray(0, vIdx), gl.STREAM_DRAW);
        gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, GL_CONST.BYTES_PER_VERTEX, GL_CONST.POS_OFFSET);
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(dataAttr, 3, gl.FLOAT, false, GL_CONST.BYTES_PER_VERTEX, GL_CONST.DATA_OFFSET);
        gl.enableVertexAttribArray(dataAttr);
        // 深度属性: 上传深度缓冲 (每个顶点 1 个 float, 与 vbo 顶点一一对应)
        if (depthAttr !== -1) {
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            // 用单独的深度 VBO 存储 (避免与主数据交错)
            if (!glDepthVBO) glDepthVBO = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, glDepthVBO);
            gl.bufferData(gl.ARRAY_BUFFER, glDepthArray.subarray(0, pointCount), gl.STREAM_DRAW);
            gl.vertexAttribPointer(depthAttr, 1, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(depthAttr);
        }
        gl.uniform1f(sizeUni, uSize);
        gl.uniform1f(intensityUni, uIntensity);
        gl.uniform1f(densityAlphaUni, densityAlpha);
        gl.uniform1f(gainUni, STATE.phosphor?.gain ?? 1.0);
        gl.uniform3fv(colorUni, colorArr);
        // 深度衰减: XYZ 模式启用 (customDepth 存在时), 否则 0 (不衰减)
        gl.uniform1f(depthFadeUni, customDepth ? 6.0 : 0.0);
        gl.drawArrays(gl.TRIANGLES, 0, pointCount);
    }
}

/**
 * 遍历并渲染所有开启通道的波形
 *
 * 余辉(phosphor persistence)实现:
 * 波形画进累积 FBO(优先 half-float HDR),每帧先用半透明背景色清屏(等效乘法衰减),
 * 新波形加法混合叠加其上,最后用 composite shader 把 FBO 内容合成到屏幕。
 */
export function renderWaveforms(theme, isLight, viewCtx) {
    if (!gl) return;
    initWebGLVars();

    const phosphorOn = STATE.phosphor && STATE.phosphor.on;
    const decay = phosphorOn ? (STATE.phosphor.decay ?? getPhosphorDecay()) : 1;

    if (phosphorOn && fbo && fboTexture && compositeProgram) {
        // ==== 余辉模式: 画进累积 FBO ====
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, currentFboWidth, currentFboHeight);
        // 衰减 pass: 画覆盖全屏的半透明背景色四边形。
        // 用混合让旧波形按 decay 保留:
        //   FBO新 = 背景*(1-decay) + FBO旧*decay
        // gl.clear() 不经过混合会直接擦掉旧帧, 无法衰减, 故用四边形覆盖。
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        // 首次进入余辉模式时清一次 FBO 建立干净基线 (此后靠衰减 pass 收敛)
        if (!_fboInitialized) {
            gl.clearColor(theme.bg[0], theme.bg[1], theme.bg[2], 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            _fboInitialized = true;
        }
        if (fadeProgram) {
            // 衰减 pass: 画覆盖全屏的半透明背景色四边形。
            // alpha = decay (每帧衰减量), 混合后:
            //   FBO新 = 背景*decay + FBO旧*(1-decay)   → 旧波形按 (1-decay) 保留
            gl.useProgram(fadeProgram);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
            gl.enableVertexAttribArray(posAttrFade);
            gl.vertexAttribPointer(posAttrFade, 2, gl.FLOAT, false, 0, 0);
            gl.uniform4f(colorUniFade, theme.bg[0], theme.bg[1], theme.bg[2], decay);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        } else {
            // fadeProgram 不可用时降级: 直接全清 (无余辉保留, 退化为普通模式)
            gl.clearColor(theme.bg[0], theme.bg[1], theme.bg[2], 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        // 新波形加法叠加 (恢复原混合)
        gl.blendFunc(gl.ONE, isLight ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);

        drawAllChannels(theme, isLight, viewCtx);

        // ==== 合成到屏幕 ====
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, currentFboWidth, currentFboHeight);
        gl.disable(gl.BLEND);
        gl.useProgram(compositeProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
        gl.enableVertexAttribArray(posAttrComposite);
        gl.vertexAttribPointer(posAttrComposite, 2, gl.FLOAT, false, 0, 0);
        // HDR 时开启色调映射(压缩超亮), 否则直通
        gl.uniform1f(tonemapUniComposite, fboHDR ? 1.0 : 0.0);
        // 合成阶段亮度直通 (波形亮度已在 fsSource u_gain 控制)
        gl.uniform1f(gainUniComposite, 1.0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboTexture);
        gl.uniform1i(texUniComposite, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.enable(gl.BLEND);
    } else {
        // ==== 无余辉: 直画屏幕 (原逻辑) ====
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, currentFboWidth, currentFboHeight);
        gl.clearColor(theme.bg[0], theme.bg[1], theme.bg[2], theme.bg[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);

        drawAllChannels(theme, isLight, viewCtx);
    }
}

/** 绘制所有开启通道 (YT / XY / XYZ), 供余辉与直画两种模式共用 */
function drawAllChannels(theme, isLight, viewCtx) {
    // 确保主波形着色器被选中 (上一帧 composite 可能改过 useProgram)
    gl.useProgram(shaderProgram);

    if (STATE.mode === 'YT') {
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            if (STATE['ch' + i].on) {
                renderGLTrace(Buffers['pData' + i], theme['c' + i], false, null, theme, isLight, viewCtx);
            }
        }
    } else if (STATE.mode === 'XY') {
        let activeCount = 0;
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            if (STATE['ch' + i]?.on) activeCount++;
        }

        if (activeCount >= 3 && STATE['ch1']?.on && STATE['ch2']?.on && STATE['ch3']?.on) {
            // XYZ 3D
            const proj = projectXYZ(Buffers.pData1, Buffers.pData2, Buffers.pData3);
            if (proj && proj.length >= 20) {
                const cycles = STATE.view3d?.trailLen || 3;
                // 优化轨迹窗口: 用固定比例采样尾部 (基于视角空间轨迹长度, 而非假设周期)
                // tailSamples = 投影点数的 cycles/4 (每周期约 len/4 点, 由 trailLen 控制)
                const tailSamples = Math.max(4, Math.min(proj.length, Math.floor(proj.length * cycles / 4)));
                const srcOff = proj.length - tailSamples;
                if (tailSamples < 4) return;
                const xData = new Float32Array(tailSamples);
                const yData = new Float32Array(tailSamples);
                const depthData = new Float32Array(tailSamples);
                for (let k = 0; k < tailSamples; k++) {
                    xData[k] = proj.xArr[srcOff + k];
                    yData[k] = proj.yArr[srcOff + k];
                    depthData[k] = proj.depthArr[srcOff + k];
                }
                renderGLTrace(xData, theme.cM || theme.cXY, true, yData, theme, isLight, null, tailSamples, null, depthData);
            }
        } else if (activeCount >= 2) {
            // 标准 2D XY 李萨如图
            renderGLTrace(Buffers.pData1, theme.cXY, true, Buffers.pData2, theme, isLight, viewCtx);
        }
    }
}

export function applyBloom() {
    if (!gl) return;
    // 辉光叠加: 不清屏, 在原画面基础上叠加 fboTexture 的模糊发光
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, currentFboWidth, currentFboHeight);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(bloomProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(posAttrBloom);
    gl.vertexAttribPointer(posAttrBloom, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(texSizeUniBloom, currentFboWidth, currentFboHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboTexture);
    gl.uniform1i(texUniBloom, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
}
