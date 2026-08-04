/**
 * ==========================================
 * Math Waveform Renderer - 数学运算波形渲染
 * ==========================================
 * �?Canvas 2D 上绘制数学通道 (Math) 波形和参数信�? */

import { STATE, CONFIG } from '../core.js';
import { ctx2d } from './context.js';

/**
 * �?Canvas 2D 上叠加绘制数学通道波形
 */
export function renderMathWaveform(w, h, theme, viewCtx) {
    if (!ctx2d) return;
    if (!STATE.math || !STATE.math.enabled) return;

    const mathData = STATE.math.data;
    if (!mathData || mathData.length === 0) return;

    const op = STATE.math.operation;
    const srcA = STATE.math.srcALabel || `CH${STATE.math.srcA || 1}`;
    const srcB = STATE.math.srcBLabel || `CH${STATE.math.srcB || 2}`;
    const opLabel = {
        'add': `${srcA}+${srcB}`,
        'sub': `${srcA}-${srcB}`,
        'mul': `${srcA}x${srcB}`,
        'div': `${srcA}/${srcB}`,
        'deriv': `d(${srcA})/dt`,
        'integ': `int(${srcA})dt`
    }[op] || op;

    ctx2d.save();

    ctx2d.strokeStyle = theme.cM ? `rgba(${theme.cM[0]*255|0},${theme.cM[1]*255|0},${theme.cM[2]*255|0},0.9)` : '#c084fc';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();

    const ptsToShow = viewCtx.ptsToShow;
    const startIdx = Math.max(0, Math.floor(viewCtx.startIdxFloat));
    const endIdx = Math.min(startIdx + Math.ceil(ptsToShow), mathData.length);
    if (endIdx <= startIdx) {
        ctx2d.restore();
        return;
    }

    const step = Math.max(1, Math.floor((endIdx - startIdx) / 400));
    const displayScale = STATE.math.displayScale ?? 1;
    const displayPos = STATE.math.displayPos ?? 0;
    let started = false;
    for (let i = startIdx; i < endIdx; i += step) {
        const x = ((i - viewCtx.startIdxFloat) / ptsToShow) * w;
        const ndcY = mathData[i] * displayScale + displayPos;
        const y = h / 2 - ndcY * (h / 2);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!started) {
            ctx2d.moveTo(x, y);
            started = true;
        } else {
            ctx2d.lineTo(x, y);
        }
    }
    if (started) ctx2d.stroke();

    ctx2d.fillStyle = '#c084fc';
    ctx2d.font = 'bold 12px monospace';
    const unit = STATE.math.unit ? ` ${STATE.math.unit}` : '';
    ctx2d.fillText(`Math: ${opLabel}${unit}`, 10, 30);

    ctx2d.restore();
}
