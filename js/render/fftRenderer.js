/**
 * ==========================================
 * FFT Renderer - 频谱渲染器
 * ==========================================
 * 负责绘制 FFT 频谱分析图
 */

// TODO: 实现频谱数据获取和处理
// TODO: 实现频谱柱状图绘制
// TODO: 实现频率刻度绘制
// TODO: 支持对数和线性刻度切换
// js/render/fftRenderer.js
import { STATE, CHANNEL_COUNT } from '../core.js';
import { RENDER, RENDER_EXT } from '../constants.js';
import { ctx2d } from './index.js';

/**
 * ==========================================
 * FFT 频谱渲染子模块
 * 负责绘制底部的频域分析图表及坐标轴
 * ==========================================
 */

export function renderFFT(w, h, theme, isLight) {
    if (!ctx2d) return;
    if (!STATE.fft || !STATE.fft.on) return;
    
    // 检查是否有任何通道的 FFT 缓冲区有数据
    const hasFftBuffer = Array.from({ length: CHANNEL_COUNT }, (_, i) => STATE.fft['buffer' + (i + 1)]).some(Boolean);
    if (!hasFftBuffer) return; 

    const currentRate = STATE.current.sampleRate; 
    let maxFreq = STATE.fft.maxFreq || RENDER.DEFAULT_FFT_MAX_FREQ;
    let gain = STATE.fft.gain || RENDER.DEFAULT_FFT_GAIN;
    let isLog = STATE.fft.logScale; 
    let numBins = STATE.fft.buffer1.length; 
    let N = numBins * 2; 
    const minFreq = RENDER.MIN_AUDIBLE_FREQ; 

    ctx2d.save();
    
    // 绘制 FFT 面板背景
    ctx2d.fillStyle = theme.fftBg; 
    ctx2d.fillRect(0, h - RENDER.FFT_PANEL_HEIGHT, w, RENDER.FFT_PANEL_HEIGHT);
    
    /** 绘制单通道 FFT 频谱柱状图 - 性能优化版 */
    const drawSpectrum = (buffer, color, offsetX) => {
        ctx2d.beginPath();
        ctx2d.strokeStyle = color; 
        ctx2d.lineWidth = 1.5;
        
        // 预计算常量，避免循环内重复计算
        const freqStep = currentRate / N;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const logRange = logMax - logMin;
        const maxBarHeight = RENDER.MAX_FFT_BAR_HEIGHT;
        
        // 计算步长，避免每像素都绘制（降采样）
        const canvasWidth = w;
        const step = Math.max(1, Math.floor(numBins / canvasWidth / 2));
        
        let started = false;
        let lastX = -1;
        
        for (let i = 0; i < numBins; i += step) {
            let freq = i * freqStep;
            if (freq > maxFreq) break; 
            
            let x = 0;
            if (isLog) {
                if (freq < minFreq) continue; 
                x = ((Math.log10(freq) - logMin) / logRange) * w;
            } else {
                x = (freq / maxFreq) * w; 
            }
            
            // 如果x坐标太接近，跳过（减少绘制点）
            if (Math.abs(x - lastX) < 1) continue;
            lastX = x;
            
            // 批量处理step个bin，取最大值（峰值保持）
            let maxMagnitude = 0;
            const endIdx = Math.min(i + step, numBins);
            for (let j = i; j < endIdx; j++) {
                if (buffer[j] > maxMagnitude) maxMagnitude = buffer[j];
            }
            
            let magnitude = maxMagnitude * gain; 
            let barHeight = magnitude > maxBarHeight ? maxBarHeight : magnitude;
            let y = h - barHeight;
            x += offsetX; 
            
            if (!started) { 
                ctx2d.moveTo(x, y); 
                started = true; 
            } else { 
                ctx2d.lineTo(x, y); 
            }
        }
        ctx2d.stroke();
    };

    // 叠加模式处理，亮色系用正常叠加，暗色系用滤色(screen)模式让颜色更亮
    ctx2d.globalCompositeOperation = isLight ? 'source-over' : 'screen'; 
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        if (STATE['ch' + i].on && STATE.fft['buffer' + i]) {
            drawSpectrum(STATE.fft['buffer' + i], theme['fftC' + i], i - 1);
        }
    }
    
    // 恢复正常叠加模式并绘制文本与刻度
    ctx2d.globalCompositeOperation = 'source-over';
    ctx2d.fillStyle = theme.fftTextDim; 
    ctx2d.font = '10px monospace';
    ctx2d.textAlign = 'center';
    
    if (isLog) {
        let marks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        for (let m of marks) {
            if (m > maxFreq || m < minFreq) continue;
            let lx = ((Math.log10(m) - Math.log10(minFreq)) / (Math.log10(maxFreq) - Math.log10(minFreq))) * w;
            ctx2d.fillText(m >= 1000 ? (m/1000)+'k' : m, lx, h - 5);
            ctx2d.globalAlpha = 0.1;
            ctx2d.fillRect(lx, h - RENDER.FFT_PANEL_HEIGHT, 1, RENDER.MAX_FFT_BAR_HEIGHT - 5);
            ctx2d.globalAlpha = 1.0;
        }
    } else {
        let steps = 6;
        for (let i = 0; i <= steps; i++) {
            let f = (maxFreq / steps) * i;
            let lx = Math.max(15, Math.min((f / maxFreq) * w, w - 15));
            ctx2d.fillText(f >= 1000 ? (f/1000).toFixed(1)+'k' : Math.round(f), lx, h - 5);
            ctx2d.globalAlpha = 0.1;
            ctx2d.fillRect(lx, h - RENDER.FFT_PANEL_HEIGHT, 1, RENDER.MAX_FFT_BAR_HEIGHT - RENDER_EXT.FFT_BAR_HEIGHT_DIFF);
            ctx2d.globalAlpha = 1.0;
        }
    }
    
    ctx2d.textAlign = 'left';
    ctx2d.fillStyle = theme.fftTextBright; 
    ctx2d.fillText(`FFT | Span: ${maxFreq}Hz | Gain: x${gain} | ${isLog ? 'LOG' : 'LIN'}`, 10, h - RENDER.FFT_TEXT_Y_OFFSET);
    
    ctx2d.restore();
}