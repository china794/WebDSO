/**
 * ==========================================
 * WebGL Renderer - WebGL 波形渲染器
 * ==========================================
 * 负责使用 WebGL 渲染波形数据
 */

// TODO: 实现 WebGL 上下文初始化
// TODO: 实现着色器编译和程序创建
// TODO: 实现波形数据渲染
// TODO: 实现辉光效果 (Bloom)
// js/render/webglRenderer.js
import { STATE, CONFIG, XY_PTS, ALPHA_LUT, GL_CONST, DOM, CHANNEL_COUNT, Buffers } from '../core.js';
import { BUFFER, WEBGL, COLOR } from '../constants.js';
import { 
    gl, 
    shaderProgram, 
    bloomProgram, 
    fboTexture, 
    currentFboWidth, 
    currentFboHeight, 
    quadVBO, 
    posAttrBloom, 
    texUniBloom, 
    texSizeUniBloom 
} from './index.js';

/**
 * ==========================================
 * WebGL 渲染子模块
 * 负责高速抗锯齿波形绘制与 Bloom 后期处理
 * ==========================================
 */

// WebGL 变量（延迟初始化）
let posAttr, dataAttr, colorUni, sizeUni, intensityUni, densityAlphaUni;
let vbo;
let glDataArray;

/** 初始化 WebGL 变量（在首次渲染时调用） */
function initWebGLVars() {
    if (posAttr !== undefined) return; // 已初始化
    if (!gl || !shaderProgram) return; // 确保WebGL已初始化
    
    posAttr = gl.getAttribLocation(shaderProgram, 'a_position');
    dataAttr = gl.getAttribLocation(shaderProgram, 'a_data');
    colorUni = gl.getUniformLocation(shaderProgram, 'u_color');
    sizeUni = gl.getUniformLocation(shaderProgram, 'u_size');
    intensityUni = gl.getUniformLocation(shaderProgram, 'u_intensity');
    densityAlphaUni = gl.getUniformLocation(shaderProgram, 'u_densityAlpha');
    
    vbo = gl.createBuffer();
    glDataArray = new Float32Array(CONFIG.fftSize * BUFFER.VERTEX_MULTIPLIER);
}

/**
 * 使用 WebGL 绘制单条波形轨迹 (Y-T 或 X-Y 模式)
 */
export function renderGLTrace(dataBuffer, colorArr, isXY, pData2_XY, theme, isLight, viewCtx) {
    if (!gl) return; // 确保WebGL已初始化
    
    let aspect = DOM.glCanvas.height / DOM.glCanvas.width;
    let vIdx = 0, pointCount = 0;
    
    // 串口模式：使用纯色线条，不渲染到FBO
    const isSerial = STATE.current && STATE.current.isSerial;
    
    // 亮度和线条粗细：Y-T模式和X-Y模式分开处理
    let uSize = isLight ? 0.002 : ((STATE.current && STATE.current.lineSize) ? STATE.current.lineSize : 0.002);
    // Y-T模式使用较高亮度(2.0)，X-Y模式使用中等亮度(1.0)
    let uIntensity = isXY ? 1.0 : 2.0;
    const densityAlpha = 1.0;

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
        // Y-T 模式：绘制时间轴波形
        let loopStart = Math.max(viewCtx.startIdxInt, 0);
        // 根据当前模式选择缓冲区大小
        const bufferSize = STATE.current.isSerial ? BUFFER.SERIAL_FFT_SIZE : CONFIG.fftSize;
        let loopEnd = Math.min(viewCtx.endIdxInt - 1, bufferSize - 1);
        
        // 性能优化：根据屏幕宽度动态计算渲染点数
        // 获取canvas实际像素宽度
        const canvasWidth = gl.canvas.width / (window.devicePixelRatio || 1);
        // 每个像素最多渲染2个点，保证波形平滑度
        const maxRenderPoints = Math.min(Math.ceil(canvasWidth * 2), 4000);
        
        const totalPoints = loopEnd - loopStart;
        let step = 1;
        if (totalPoints > maxRenderPoints) {
            step = Math.ceil(totalPoints / maxRenderPoints);
        }
        
        // 使用更高效的峰值保持算法
        if (step > 1) {
            // 批量处理，减少函数调用开销
            for (let i = loopStart; i < loopEnd; i += step) {
                const endIdx = Math.min(i + step, loopEnd);
                let maxVal = dataBuffer[i];
                let minVal = maxVal;
                
                // 手动展开循环，提高性能
                for (let j = i + 1; j < endIdx; j++) {
                    const val = dataBuffer[j];
                    if (val > maxVal) maxVal = val;
                    if (val < minVal) minVal = val;
                }
                
                const x = ((i - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * 2.0 - 1.0;
                const x2 = ((endIdx - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * 2.0 - 1.0;
                
                // 绘制垂直线表示范围
                addPt(x, minVal, x, maxVal);
                if (x2 > x) {
                    addPt(x, maxVal, x2, (dataBuffer[endIdx] + dataBuffer[endIdx - 1]) / 2);
                }
            }
        } else {
            // 步长为1时，直接绘制，减少条件判断
            for (let i = loopStart; i < loopEnd; i++) {
                addPt(((i - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * 2.0 - 1.0, dataBuffer[i],
                      ((i + 1 - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * 2.0 - 1.0, dataBuffer[i+1]);
            }
        }
    } else {
        // X-Y 模式：绘制李萨如/矢量图形
        let sIdx = Math.max(0, CONFIG.fftSize - XY_PTS - 1);
        for (let i = 1; i < XY_PTS - 1; i++) {
            if (ALPHA_LUT[i] < COLOR.MIN_ALPHA) continue;
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
        gl.uniform1f(densityAlphaUni, densityAlpha);
        gl.uniform3fv(colorUni, colorArr);
        gl.drawArrays(gl.TRIANGLES, 0, pointCount);
    }
}

/**
 * 遍历并渲染所有开启通道的波形
 */
export function renderWaveforms(theme, isLight, viewCtx) {
    if (!gl) return; // 确保WebGL已初始化
    
    initWebGLVars(); // 延迟初始化 WebGL 变量
    
    // 所有模式直接渲染到屏幕，不使用FBO和辉光效果
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, currentFboWidth, currentFboHeight);
    // 清除背景，使用主题背景色
    gl.clearColor(theme.bg[0], theme.bg[1], theme.bg[2], theme.bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    if (STATE.mode === 'YT') {
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            if (STATE['ch' + i].on) {
                renderGLTrace(Buffers['pData' + i], theme['c' + i], false, null, theme, isLight, viewCtx);
            }
        }
    } else if (STATE.mode === 'XY') {
        renderGLTrace(Buffers.pData1, theme.cXY, true, Buffers.pData2, theme, isLight, viewCtx);
    }
}

/**
 * 执行 Bloom 发光后期处理
 */
export function applyBloom() {
    if (!gl) return; // 确保WebGL已初始化
    
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
}