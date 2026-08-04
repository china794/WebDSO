/**
 * ==========================================
 * 串口音频监听模块 (Serial Audio Monitor)
 * ==========================================
 * 将串口实时数据转为可听音频信号。
 * 包含 DC Blocker（一阶高通滤波）、相位重采样、音频流调度。
 */

import { AudioState } from '../audio.js';
import { BUFFER, AUDIO } from '../constants.js';

/**
 * 创建音频监听状态
 */
export function createAudioMonitorState() {
    return {
        accumL: [],
        accumR: [],
        nextTime: 0,
        phase: 0,
        dcXL: 0, dcYL: 0,
        dcXR: 0, dcYR: 0,
        masterGain: null
    };
}

/**
 * 将新收到的串口数据转换为可听音频（DC Blocker + 重采样）
 * @param {Object} mon - 音频监听状态
 * @param {number[]} frame - 当前帧的样本数组
 * @param {number} leftCh - 左声道通道索引 (0-7)
 * @param {number} rightCh - 右声道通道索引 (0-7)
 * @param {number} currentRate - 当前采样率
 */
export function feedAudioMonitor(mon, frame, leftCh, rightCh, currentRate) {
    const v1 = (frame[leftCh] !== undefined ? frame[leftCh] : 0);
    const v2 = (frame[rightCh] !== undefined ? frame[rightCh] : v1);

    // DC Blocker（一阶高通滤波）
    const R = 0.995;
    const dcY_L = v1 - mon.dcXL + R * mon.dcYL;
    mon.dcXL = v1;
    mon.dcYL = dcY_L;

    const dcY_R = v2 - mon.dcXR + R * mon.dcYR;
    mon.dcXR = v2;
    mon.dcYR = dcY_R;

    // 振幅归一化
    const outL = Math.max(-1, Math.min(1, (dcY_L / 3.3) * 1.5));
    const outR = Math.max(-1, Math.min(1, (dcY_R / 3.3) * 1.5));

    // 相位重采样
    const targetRate = Math.max(8000, Math.min(96000, currentRate));
    mon.phase += targetRate / currentRate;

    while (mon.phase >= 1.0) {
        mon.phase -= 1.0;
        mon.accumL.push(outL);
        mon.accumR.push(outR);
    }

    if (mon.accumL.length >= BUFFER.AUDIO_CHUNK) {
        playAudioChunk(mon, targetRate);
    }
}

/**
 * 播放音频块到 WebAudio 输出
 * @param {Object} mon - 音频监听状态
 * @param {number} playRate - 播放采样率
 */
function playAudioChunk(mon, playRate) {
    if (!AudioState.audioCtx || AudioState.audioCtx.state !== 'running') return;

    const ctx = AudioState.audioCtx;

    if (!mon.masterGain) {
        mon.masterGain = ctx.createGain();
        mon.masterGain.gain.value = AUDIO.MASTER_VOLUME || 0.5;
        mon.masterGain.connect(ctx.destination);
    }

    const len = mon.accumL.length;
    if (len === 0) return;

    const buffer = ctx.createBuffer(2, len, playRate);
    buffer.copyToChannel(new Float32Array(mon.accumL), 0);
    buffer.copyToChannel(new Float32Array(mon.accumR), 1);

    mon.accumL = [];
    mon.accumR = [];

    const now = ctx.currentTime;

    if (mon.nextTime < now) {
        mon.nextTime = now + 0.05;
    } else if (mon.nextTime > now + 0.5) {
        mon.nextTime = now + 0.05;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(mon.masterGain);
    source.start(mon.nextTime);
    mon.nextTime += buffer.duration;
}

/**
 * 重置音频状态（开关扬声器时调用）
 * @param {Object} mon - 音频监听状态
 */
export function resetAudioMonitor(mon) {
    mon.accumL = [];
    mon.accumR = [];
    mon.phase = 0;
    mon.dcXL = 0; mon.dcYL = 0;
    mon.dcXR = 0; mon.dcYR = 0;
}
