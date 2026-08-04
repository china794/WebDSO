/**
 * ==========================================
 * 性能监控面板 (Perf Monitor)
 * ==========================================
 * 轻量级性能数据收集与显示
 */

import { STATE } from '../core.js';
import { ctx2d } from './context.js';

// 帧时间历史（滑动窗口）
const FRAME_TIMES = new Float32Array(60);
let _frameIdx = 0;
let _lastTime = performance.now();
let _fps = 0;

// 渲染阶段耗时
export const perfTiming = {
    canvas2d: 0,
    dataAcq: 0,
    process: 0,
    webgl: 0,
    total: 0
};

let _timingStart = 0;

/** 开始计时（在帧开始时调用） */
export function startFrame() {
    _timingStart = performance.now();
}

/** 记录阶段耗时 */
export function markPhase(phase) {
    const now = performance.now();
    if (perfTiming[phase] !== undefined) {
        perfTiming[phase] = now - _timingStart;
    }
}

/** 完成帧计时 */
export function endFrame() {
    const now = performance.now();
    const elapsed = now - _lastTime;
    _lastTime = now;

    FRAME_TIMES[_frameIdx % 60] = elapsed;
    _frameIdx++;

    // 每秒更新一次 FPS
    if (_frameIdx % 15 === 0) {
        let sum = 0;
        const count = Math.min(_frameIdx, 60);
        for (let i = 0; i < count; i++) sum += FRAME_TIMES[i];
        _fps = count > 0 && sum > 0 ? Math.round(1000 / (sum / count)) : 0;
    }

    perfTiming.total = now - _timingStart;
}

/**
 * 绘制性能监控面板
 */
export function renderPerfMonitor(w, h) {
    if (!ctx2d) return;

    ctx2d.save();

    // 背景
    const panelW = 160;
    const panelH = 48;
    const px = 8;
    const py = 8;

    ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
    ctx2d.fillRect(px, py, panelW, panelH);

    // FPS
    const fpsColor = _fps >= 50 ? '#4ade80' : _fps >= 30 ? '#fbbf24' : '#ef4444';
    ctx2d.fillStyle = fpsColor;
    ctx2d.font = 'bold 13px monospace';
    ctx2d.fillText(`${_fps} FPS`, px + 8, py + 16);

    // 帧耗时
    ctx2d.fillStyle = '#a1a1aa';
    ctx2d.font = '9px monospace';
    const totalMs = perfTiming.total.toFixed(1);
    ctx2d.fillText(`${totalMs}ms`, px + 8, py + 30);

    // 串口采样率
    if (STATE.current.isSerial && STATE.realSampleMeasurer) {
        const rate = STATE.realSampleMeasurer.actualRate || 0;
        const rateStr = rate > 1000 ? (rate / 1000).toFixed(1) + 'k' : rate + '';
        ctx2d.fillStyle = '#38bdf8';
        ctx2d.fillText(`Serial: ${rateStr} sps`, px + 8, py + 42);
    }

    ctx2d.restore();
}
