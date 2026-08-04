/**
 * ==========================================
 * FFT Renderer - 频谱渲染器
 * ==========================================
 * 负责绘制 FFT 频谱分析图。
 *
 * 设计参考 audioMotion / spectrogram-js / Frieve-A 等业界领先频谱仪的
 * 视觉与数据处理最佳实践：
 *  - dB 对数振幅刻度（-100~-3 dBFS），强弱信号同屏可见
 *  - 渐变着色 + 填充（底部半透明 → 顶部亮色），比单色折线更富层次
 *  - 峰值保持线（缓慢衰减的亮点线），专业频谱仪的标志
 *  - 对数频率轴 1-2-5 刻度
 */

import { STATE, CHANNEL_COUNT } from '../core.js';
import { RENDER } from '../constants.js';
import { ctx2d } from './context.js';

/**
 * ==========================================
 * FFT 频谱渲染子模块
 * ==========================================
 */

/** 从 rgba(...) 字符串解析出 [r,g,b] 分量（用于构建渐变） */
function rgbaToRgb(rgbaStr) {
    const m = rgbaStr.match(/rgba?\(([^)]+)\)/);
    if (!m) return [255, 255, 255];
    const parts = m[1].split(',').map(s => parseFloat(s.trim()));
    return [parts[0], parts[1], parts[2]];
}

export function renderFFT(w, h, theme, isLight) {
    if (!ctx2d) return;
    if (!STATE.fft || !STATE.fft.on) return;

    // 检查是否有任何通道的 FFT 缓冲区有数据
    const hasFftBuffer = Array.from({ length: CHANNEL_COUNT }, (_, i) => STATE.fft['buffer' + (i + 1)]).some(Boolean);
    if (!hasFftBuffer) return;

    // 实时 FFT：频率轴直接用当前采样率标定
    const currentRate = STATE.current.sampleRate;
    const maxFreq = STATE.fft.maxFreq || RENDER.DEFAULT_FFT_MAX_FREQ;
    const isLog = STATE.fft.logScale;
    const minFreq = RENDER.MIN_AUDIBLE_FREQ;
    const dbFloor = RENDER.FFT_DB_FLOOR;
    const dbCeil = RENDER.FFT_DB_CEIL;
    const dbRange = dbCeil - dbFloor;
    const panelH = RENDER.FFT_PANEL_HEIGHT;
    const maxBar = RENDER.MAX_FFT_BAR_HEIGHT;
    const panelTop = h - panelH;

    ctx2d.save();

    // 绘制 FFT 面板背景
    ctx2d.fillStyle = theme.fftBg;
    ctx2d.fillRect(0, panelTop, w, panelH);

    // 面板分隔线
    ctx2d.strokeStyle = theme.fftTextDim;
    ctx2d.globalAlpha = 0.25;
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(0, panelTop);
    ctx2d.lineTo(w, panelTop);
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;

    // dB → 垂直坐标：dbFloor 贴底，dbCeil 贴顶
    const yOfDb = (db) => {
        const frac = (db - dbFloor) / dbRange;   // 0..1
        return panelTop + (1 - frac) * maxBar;
    };

    // 频率 → 水平坐标（对数/线性）
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    const logRange = logMax - logMin;
    const xOfFreq = (f) => {
        if (isLog) return ((Math.log10(f) - logMin) / logRange) * w;
        return (f / maxFreq) * w;
    };
    // bin → 频率
    const freqOfBin = (bin, freqStep) => bin * freqStep;

    /** 绘制单通道 FFT 频谱 - 渐变填充 + 峰值保持线 */
    const drawSpectrum = (dbBuffer, peakBuffer, color, offsetX) => {
        if (!dbBuffer || dbBuffer.length < 2) return;
        const numBins = dbBuffer.length;
        const N = numBins * 2;
        const freqStep = currentRate / N;
        const [r, g, b] = rgbaToRgb(color);

        const binToX = (bin) => xOfFreq(freqOfBin(bin, freqStep)) + offsetX;

        // 收集绘制点（对数：按对数均匀采样；线性：按步长采样）
        const pts = [];
        if (isLog) {
            // 对数采样点：每个点负责 [中点_{k-1}, 中点_k) 的 bin 区间，峰值保持
            const logSamples = Math.max(50, Math.round(w * 0.9));
            const logStep = logRange / logSamples;
            let lastStartBin = -1;
            for (let k = 0; k <= logSamples; k++) {
                const freq = Math.pow(10, logMin + logStep * k);
                if (freq < minFreq || freq > maxFreq) continue;
                const freqLo = Math.pow(10, logMin + logStep * (k - 0.5));
                const freqHi = Math.pow(10, logMin + logStep * (k + 0.5));
                const startBin = Math.round(freqLo / freqStep);
                const endBin = Math.round(freqHi / freqStep);
                if (startBin >= numBins || endBin < startBin) continue;
                if (startBin === lastStartBin) continue;
                lastStartBin = startBin;
                let maxDb = dbFloor;
                for (let j = Math.max(0, startBin); j <= Math.min(numBins - 1, endBin); j++) {
                    if (dbBuffer[j] > maxDb) maxDb = dbBuffer[j];
                }
                const x = binToX(Math.max(0, startBin));
                pts.push({ x, y: yOfDb(maxDb), db: maxDb });
            }
        } else {
            // 线性：按步长降采样，取区间峰值
            const step = Math.max(1, Math.floor(numBins / w / 2));
            for (let i = 0; i < numBins; i += step) {
                const f = freqOfBin(i, freqStep);
                if (f > maxFreq) break;
                let maxDb = dbFloor;
                const endIdx = Math.min(i + step, numBins);
                for (let j = i; j < endIdx; j++) {
                    if (dbBuffer[j] > maxDb) maxDb = dbBuffer[j];
                }
                pts.push({ x: binToX(i), y: yOfDb(maxDb), db: maxDb });
            }
        }
        if (pts.length < 2) return;

        // ==== 渐变填充频谱主体 ====
        // 从底部 (半透明同色) 到顶部 (高亮)，模拟 LED/发光频谱
        const grad = ctx2d.createLinearGradient(0, panelTop + maxBar, 0, panelTop);
        grad.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
        grad.addColorStop(0.6, `rgba(${r},${g},${b},0.45)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0.95)`);
        ctx2d.beginPath();
        ctx2d.moveTo(pts[0].x, panelTop + maxBar);
        for (const p of pts) ctx2d.lineTo(p.x, p.y);
        ctx2d.lineTo(pts[pts.length - 1].x, panelTop + maxBar);
        ctx2d.closePath();
        ctx2d.fillStyle = grad;
        ctx2d.fill();

        // ==== 频谱顶部描边（亮色） ====
        ctx2d.beginPath();
        ctx2d.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx2d.lineTo(pts[i].x, pts[i].y);
        ctx2d.strokeStyle = `rgba(${r},${g},${b},0.9)`;
        ctx2d.lineWidth = 1.5;
        ctx2d.stroke();

        // ==== 峰值保持线（若开启） ====
        if (STATE.fft.showPeaks && peakBuffer && peakBuffer.length === numBins) {
            const peakPts = [];
            // 用同样采样法取 peakBuffer 峰值
            if (isLog) {
                const logSamples = Math.max(50, Math.round(w * 0.9));
                const logStep = logRange / logSamples;
                let lastStartBin = -1;
                for (let k = 0; k <= logSamples; k++) {
                    const freq = Math.pow(10, logMin + logStep * k);
                    if (freq < minFreq || freq > maxFreq) continue;
                    const freqLo = Math.pow(10, logMin + logStep * (k - 0.5));
                    const freqHi = Math.pow(10, logMin + logStep * (k + 0.5));
                    const startBin = Math.round(freqLo / freqStep);
                    const endBin = Math.round(freqHi / freqStep);
                    if (startBin >= numBins || endBin < startBin) continue;
                    if (startBin === lastStartBin) continue;
                    lastStartBin = startBin;
                    let maxDb = dbFloor;
                    for (let j = Math.max(0, startBin); j <= Math.min(numBins - 1, endBin); j++) {
                        if (peakBuffer[j] > maxDb) maxDb = peakBuffer[j];
                    }
                    peakPts.push({ x: binToX(Math.max(0, startBin)), y: yOfDb(maxDb) });
                }
            } else {
                const step = Math.max(1, Math.floor(numBins / w / 2));
                for (let i = 0; i < numBins; i += step) {
                    const f = freqOfBin(i, freqStep);
                    if (f > maxFreq) break;
                    let maxDb = dbFloor;
                    const endIdx = Math.min(i + step, numBins);
                    for (let j = i; j < endIdx; j++) {
                        if (peakBuffer[j] > maxDb) maxDb = peakBuffer[j];
                    }
                    peakPts.push({ x: binToX(i), y: yOfDb(maxDb) });
                }
            }
            if (peakPts.length >= 2) {
                ctx2d.beginPath();
                ctx2d.moveTo(peakPts[0].x, peakPts[0].y);
                for (let i = 1; i < peakPts.length; i++) ctx2d.lineTo(peakPts[i].x, peakPts[i].y);
                ctx2d.strokeStyle = `rgba(255,255,255,0.55)`;
                ctx2d.lineWidth = 1;
                ctx2d.stroke();
            }
        }
    };

    // 叠加模式处理，亮色系用正常叠加，暗色系用滤色(screen)模式让颜色更亮
    ctx2d.globalCompositeOperation = isLight ? 'source-over' : 'screen';
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        if (STATE['ch' + i].on && STATE.fft['buffer' + i]) {
            drawSpectrum(STATE.fft['dbBuffer' + i], STATE.fft['peakBuffer' + i], theme['fftC' + i], 0);
        }
    }

    // 恢复正常叠加模式并绘制文本与刻度
    ctx2d.globalCompositeOperation = 'source-over';
    ctx2d.fillStyle = theme.fftTextDim;
    ctx2d.font = '10px monospace';
    ctx2d.textAlign = 'center';

    // 频率刻度：对数用 1-2-5 序列，线性用等分
    const drawTick = (f) => {
        if (f < minFreq || f > maxFreq) return;
        const lx = xOfFreq(f);
        ctx2d.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), lx, h - 5);
        ctx2d.globalAlpha = 0.15;
        ctx2d.fillRect(lx, panelTop, 1, maxBar);
        ctx2d.globalAlpha = 1;
    };

    if (isLog) {
        // 1-2-5 对数刻度序列
        for (let decade = 1; decade <= maxFreq; decade *= 10) {
            for (let m of [1, 2, 5]) {
                drawTick(m * decade);
            }
        }
    } else {
        const steps = 6;
        for (let i = 0; i <= steps; i++) {
            drawTick((maxFreq / steps) * i);
        }
    }

    // 右下角状态文本
    ctx2d.textAlign = 'left';
    ctx2d.fillStyle = theme.fftTextBright;
    const modeStr = isLog ? 'LOG' : 'LIN';
    const pkStr = STATE.fft.showPeaks ? 'PK' : '';
    ctx2d.fillText(`FFT | ${maxFreq}Hz | ${modeStr}${pkStr ? ' | ' + pkStr : ''} | ${dbFloor}~${dbCeil}dB`, 10, h - RENDER.FFT_TEXT_Y_OFFSET);

    ctx2d.restore();
}
