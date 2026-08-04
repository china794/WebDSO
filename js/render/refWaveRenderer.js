/**
 * ==========================================
 * 参考波形渲染器 (Reference Waveform)
 * ==========================================
 * 以半透明灰色叠加显示保存的波形快照
 */

import { STATE } from '../core.js';
import { ctx2d } from './context.js';

export function renderRefWaveform(w, h, theme, viewCtx) {
    if (!ctx2d) return;
    if (!STATE.refWave || !STATE.refWave.active || !STATE.refWave.data) return;

    const refData = STATE.refWave.data;
    const ptsToShow = viewCtx.ptsToShow;
    const startIdx = viewCtx.startIdxFloat;
    const endIdxFloat = startIdx + ptsToShow;
    const totalLen = refData.length;

    ctx2d.save();

    // 使用半透明紫色
    ctx2d.strokeStyle = 'rgba(192, 132, 252, 0.45)';
    ctx2d.lineWidth = 1.5;
    ctx2d.setLineDash([6, 4]);
    ctx2d.beginPath();

    const start = Math.max(0, Math.floor(startIdx));
    const end = Math.min(totalLen, Math.ceil(endIdxFloat));
    const step = Math.max(1, Math.floor((end - start) / 400));

    let started = false;
    for (let i = start; i < end; i += step) {
        const x = ((i - startIdx) / ptsToShow) * w;
        const y = h / 2 - refData[i] * (h / 2);
        if (!started) {
            ctx2d.moveTo(x, y);
            started = true;
        } else {
            ctx2d.lineTo(x, y);
        }
    }
    ctx2d.stroke();
    ctx2d.setLineDash([]);

    // 标签
    ctx2d.fillStyle = 'rgba(192, 132, 252, 0.6)';
    ctx2d.font = '9px monospace';
    ctx2d.fillText(`Ref CH${STATE.refWave.ch}`, 10, h - 8);

    ctx2d.restore();
}
