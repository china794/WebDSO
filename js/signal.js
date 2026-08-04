import { STATE, CONFIG, CHANNEL_COUNT } from './core.js';
import { FFT } from './lib/fft.js';
import { BUFFER, TRIGGER, MEASUREMENT, GRID, RENDER } from './constants.js';

const FFT_SIZE = BUFFER.FFT_SIZE;
const fftProcessor = new FFT(FFT_SIZE);
const fftInput = new Float32Array(FFT_SIZE);

function formatVoltage(value) {
    if (!Number.isFinite(value)) return '-- V';
    return `${value.toFixed(2)} V`;
}

function formatFrequency(value) {
    if (!Number.isFinite(value) || value <= 0) return '-- Hz';
    return value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${Math.round(value)} Hz`;
}

function formatPeriod(value) {
    if (!Number.isFinite(value) || value <= 0) return '-- ms';
    return `${(value * 1000).toFixed(3)} ms`;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent !== value) el.textContent = value;
}

/**
 * 一阶高通滤波器（AC 耦合）。
 * @param {Float32Array} input
 * @param {Float32Array} output
 * @param {number} cutoffHz - 截止频率 (Hz)
 * @param {number} sampleRate - 采样率 (Hz)
 * 差分高通 y[n] = alpha·(y[n-1] + x[n] - x[n-1])，系数取 rc/(rc+dt)，
 * dt = 1/sampleRate，物理截止点正确。
 */
function highpassFilter(input, output, cutoffHz, sampleRate) {
    const fs = Math.max(1, sampleRate);
    const rc = 1.0 / (2.0 * Math.PI * cutoffHz);
    const dt = 1.0 / fs;
    const alpha = rc / (rc + dt);
    let y = input[0] || 0;
    output[0] = y;

    for (let i = 1; i < input.length; i++) {
        y = alpha * (y + input[i] - input[i - 1]);
        output[i] = y;
    }
}

function pulseWidthMatch(width, target, mode) {
    return mode === '>' ? width > target : width < target;
}

function checkPulseWidth(data, triggerIdx, level, edge) {
    if (triggerIdx <= 0 || triggerIdx >= data.length - 1) return -1;

    if (edge === 1) {
        for (let j = triggerIdx + 1; j < data.length; j++) {
            if (data[j] <= level) return j - triggerIdx;
        }
    } else {
        for (let j = triggerIdx + 1; j < data.length; j++) {
            if (data[j] >= level) return j - triggerIdx;
        }
    }
    return -1;
}

export function findTriggerIndex(data, ptsNeeded, offset, targetLevel) {
    if (!data || data.length < 2) return -1;

    const trig = STATE.trigger;
    const dir = trig.edge;
    const hys = TRIGGER.HYSTERESIS;
    const bufferSize = Math.min(data.length, STATE.current.isSerial ? BUFFER.SERIAL_FFT_SIZE : CONFIG.fftSize);
    // 保证搜索窗至少覆盖一个最小宽度，避免快速时基下塌缩成 2 个采样点导致触发恒失败
    const MIN_SEARCH_WIDTH = TRIGGER.SEARCH_START + TRIGGER.SEARCH_END_OFFSET;
    const requestedEnd = Number.isFinite(offset) && Number.isFinite(ptsNeeded)
        ? Math.floor(offset + ptsNeeded)
        : Math.floor(bufferSize / 2) + TRIGGER.SEARCH_END_OFFSET;
    const clampedEnd = Math.max(requestedEnd, MIN_SEARCH_WIDTH);

    let searchEnd = Math.min(bufferSize - 1, clampedEnd);
    let searchStart = Math.max(1, Math.min(TRIGGER.SEARCH_START, searchEnd - 1));

    if (trig.holdoff > 0 && trig.frozenIdx > 0) {
        const holdoffStart = Math.floor(trig.frozenIdx + trig.holdoff);
        searchStart = Math.max(searchStart, Math.min(holdoffStart, searchEnd - 1));
    }

    let filtered = data;
    let temp = null;
    if (trig.hfReject || trig.lfReject) {
        temp = new Float32Array(data.length);
        temp.set(data);
        filtered = temp;

        if (trig.hfReject) {
            for (let i = 1; i < filtered.length - 1; i++) {
                filtered[i] = (filtered[i - 1] + filtered[i] * 2 + filtered[i + 1]) / 4;
            }
        }
        if (trig.lfReject) {
            const alpha = 0.8;
            let prevIn = filtered[0];
            let prevOut = 0;
            filtered[0] = 0;
            for (let i = 1; i < filtered.length; i++) {
                const currIn = filtered[i];
                const currOut = currIn - prevIn + alpha * prevOut;
                filtered[i] = currOut;
                prevIn = currIn;
                prevOut = currOut;
            }
        }
    }

    for (let i = searchEnd; i >= searchStart; i--) {
        const curr = filtered[i];
        const prev = filtered[i - 1];

        if (dir === 1 && prev < targetLevel && curr >= targetLevel) {
            let isReal = false;
            for (let j = i - 1; j >= Math.max(0, i - TRIGGER.HISTORY_DEPTH); j--) {
                if (filtered[j] <= targetLevel - hys) { isReal = true; break; }
                if (filtered[j] >= targetLevel) break;
            }
            if (!isReal) continue;
            if (trig.pulseWidth > 0) {
                const pw = checkPulseWidth(filtered, i, targetLevel, trig.edge);
                if (pw < 0 || !pulseWidthMatch(pw, trig.pulseWidth, trig.pulseMode)) continue;
            }
            return (i - 1) + (curr !== prev ? (targetLevel - prev) / (curr - prev) : 0);
        }

        if (dir === -1 && prev > targetLevel && curr <= targetLevel) {
            let isReal = false;
            for (let j = i - 1; j >= Math.max(0, i - TRIGGER.HISTORY_DEPTH); j--) {
                if (filtered[j] >= targetLevel + hys) { isReal = true; break; }
                if (filtered[j] <= targetLevel) break;
            }
            if (!isReal) continue;
            if (trig.pulseWidth > 0) {
                const pw = checkPulseWidth(filtered, i, targetLevel, trig.edge);
                if (pw < 0 || !pulseWidthMatch(pw, trig.pulseWidth, trig.pulseMode)) continue;
            }
            return (i - 1) + (curr !== prev ? (targetLevel - prev) / (curr - prev) : 0);
        }
    }

    return -1;
}

export function processData(rawArray, stateObj, out) {
    if (!rawArray || !out || !stateObj) return;
    if (stateObj.cpl === 'GND') {
        out.fill(0);
        return;
    }

    const ndcPerDiv = GRID.NDC_PER_DIV;
    if (stateObj.cpl === 'AC') {
        const sampleRate = STATE.current.sampleRate || CONFIG.sampleRate;
        // 10Hz 高通截止：不再 clamp 到 0.01（那会把截止点推到 ~1kHz，严重衰减低频）
        const cutoffHz = 10;
        highpassFilter(rawArray, out, cutoffHz, sampleRate);
        for (let i = 0; i < out.length; i++) {
            out[i] = out[i] * stateObj.scale * ndcPerDiv + stateObj.pos;
        }
        return;
    }

    for (let i = 0; i < rawArray.length && i < out.length; i++) {
        out[i] = rawArray[i] * stateObj.scale * ndcPerDiv + stateObj.pos;
    }
}

function measureChannel(arr, startIdx, endIdx, sampleRate, cpl) {
    const scanLen = Math.max(0, endIdx - startIdx);
    if (!arr || scanLen <= 1) {
        return { vpp: 0, vmax: 0, vmin: 0, vavg: 0, rms: 0, freq: 0, period: 0, duty: 0 };
    }

    let offset = 0;
    if (cpl === 'AC') {
        for (let i = startIdx; i < endIdx; i++) offset += arr[i];
        offset /= scanLen;
    }

    let max = -Infinity;
    let min = Infinity;
    let sum = 0;
    let sumSq = 0;
    for (let i = startIdx; i < endIdx; i++) {
        const val = arr[i] - offset;
        if (val > max) max = val;
        if (val < min) min = val;
        sum += val;
        sumSq += val * val;
    }

    const avg = sum / scanLen;
    const rms = Math.sqrt(sumSq / scanLen);
    const vpp = max - min;
    const mid = (max + min) * 0.5;
    const hys = Math.max(vpp * 0.1, 1e-9);
    const high = mid + hys;
    const low = mid - hys;
    let isHigh = (arr[startIdx] - offset) > mid;
    const edges = [];
    let highSamples = 0;

    for (let i = startIdx + 1; i < endIdx; i++) {
        const val = arr[i] - offset;
        if (val > mid) highSamples++;
        if (isHigh && val < low) {
            isHigh = false;
        } else if (!isHigh && val > high) {
            isHigh = true;
            const prev = arr[i - 1] - offset;
            const frac = val !== prev ? (mid - prev) / (val - prev) : 0;
            edges.push((i - 1) + Math.max(0, Math.min(1, frac)));
        }
    }

    let freq = 0;
    let period = 0;
    if (edges.length >= 2) {
        const samplesBetween = edges[edges.length - 1] - edges[0];
        const cycles = edges.length - 1;
        if (samplesBetween > 0) {
            freq = (cycles * sampleRate) / samplesBetween;
            period = 1 / freq;
        }
    }

    return {
        vpp,
        vmax: max,
        vmin: min,
        vavg: avg,
        rms,
        freq,
        period,
        duty: scanLen > 0 ? (highSamples / scanLen) * 100 : 0
    };
}

function updateMeasurementDom(ch, result) {
    setText(`meas-ch${ch}-freq`, formatFrequency(result.freq));
    setText(`meas-ch${ch}-vpp`, formatVoltage(result.vpp));
    setText(`meas-ch${ch}-vmax`, formatVoltage(result.vmax));
    setText(`meas-ch${ch}-vmin`, formatVoltage(result.vmin));
    setText(`meas-ch${ch}-vavg`, formatVoltage(result.vavg));
    setText(`meas-ch${ch}-rms`, formatVoltage(result.rms));
    setText(`meas-ch${ch}-period`, formatPeriod(result.period));
    setText(`meas-ch${ch}-duty`, Number.isFinite(result.duty) ? `${result.duty.toFixed(1)}%` : '--%');
}

// FFT 重算策略：每帧轮询部分通道，而非一次性重算所有通道。
// 单次 32768 点 FFT 约 2.8ms，60fps 帧预算 16.6ms，每帧安全跑约 3 次。
// FFT_THROTTLE_FRAMES = 3 → 3 帧轮完所有开启通道：
//   单通道：每帧都算 → 60Hz 更新，非常丝滑
//   8 通道：每帧 3 次 → 每通道 20Hz，视觉平滑且不卡死
const FFT_THROTTLE_FRAMES = 3;
let _fftFrameCounter = 0;

/**
 * 实时 FFT：直接使用 analyser 最新采集的数据（rawArrays）。
 * 数据管线：Hann 窗 → FFT 幅值谱 → dB 转换 → 时间平滑 → 峰值保持。
 * 参考 audioMotion / spectrogram-js 等主流频谱仪的业界最佳实践：
 *  - Hann 窗抑制频谱泄漏（旁瓣）
 *  - dB 对数振幅刻度（-100~-3 dBFS），可同时看清强峰与弱信号，避免线性归一化把低频压平
 *  - 时间平滑（指数加权），频谱有流动感而非每帧跳动
 *  - 峰值保持线（缓慢衰减），专业频谱仪的标志
 */
// 预计算 Hann 窗系数（模块级，避免每帧重建）
let _hannWindow = null;
function getHannWindow(len) {
    if (!_hannWindow || _hannWindow.length !== len) {
        _hannWindow = new Float32Array(len);
        for (let i = 0; i < len; i++) _hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)));
    }
    return _hannWindow;
}
// 预分配 dB 频谱临时缓冲
let _dbTemp = null;
// 预分配峰值保持临时缓冲
let _peakTemp = null;

function updateFft(rawArrays) {
    if (!(STATE.fft && STATE.fft.on)) return;

    // 收集开启通道
    const activeChs = [];
    for (let i = 0; i < CHANNEL_COUNT; i++) {
        if (STATE[`ch${i + 1}`]?.on) activeChs.push(i);
    }
    if (activeChs.length === 0) return;

    const FFT = STATE.fft;
    // 每帧重算 ceil(activeCount/3) 个通道，round-robin 轮询
    const perFrame = Math.max(1, Math.ceil(activeChs.length / FFT_THROTTLE_FRAMES));
    const frame = _fftFrameCounter;
    _fftFrameCounter = (_fftFrameCounter + 1) % FFT_THROTTLE_FRAMES;

    const dbFloor = RENDER.FFT_DB_FLOOR;       // -100
    const dbCeil = RENDER.FFT_DB_CEIL;         // -3
    const dbRange = dbCeil - dbFloor;          // 97 dB
    const smoothing = FFT.smoothing ?? RENDER.FFT_SMOOTHING;
    const hann = getHannWindow(FFT_SIZE);

    for (let k = 0; k < perFrame; k++) {
        const chIdx = activeChs[(frame * perFrame + k) % activeChs.length];
        const ch = chIdx + 1;
        const source = rawArrays[chIdx];
        if (!source) continue;

        const key = `buffer${ch}`;
        const dbKey = `dbBuffer${ch}`;
        const pkKey = `peakBuffer${ch}`;

        // 静音检测：基于最新实时数据（rawArrays = analyser 最新采集）。
        // 关闭输入源后立即清零频谱，避免显示噪声/残留伪峰。
        let liveRms = 0;
        const liveLen = Math.min(source.length, FFT_SIZE);
        for (let j = 0; j < liveLen; j++) liveRms += source[j] * source[j];
        liveRms = Math.sqrt(liveRms / liveLen);
        if (liveRms < 0.001) {
            // 静音：清零频谱。确保 buffer 长度为 FFT_SIZE/2（初始是 FFT_SMALL=4096，
            // 若保持 4096 会导致渲染端用错误长度遍历越界）
            if (!FFT[key] || FFT[key].length !== FFT_SIZE / 2) {
                FFT[key] = new Float32Array(FFT_SIZE / 2);
                FFT[dbKey] = new Float32Array(FFT_SIZE / 2);
                FFT[pkKey] = new Float32Array(FFT_SIZE / 2);
            }
            FFT[key].fill(0);
            FFT[dbKey].fill(dbFloor);
            FFT[pkKey].fill(dbFloor);
            continue;
        }

        // 实时 FFT：直接用最新 analyser 数据（与波形显示同源，零滞后）
        fftInput.fill(0);
        if (source.length >= FFT_SIZE) {
            fftInput.set(source.subarray(source.length - FFT_SIZE));
        } else {
            fftInput.set(source);
        }

        // 去直流 + 应用 Hann 窗（抑制频谱泄漏）
        let mean = 0;
        for (let j = 0; j < FFT_SIZE; j++) mean += fftInput[j];
        mean /= FFT_SIZE;
        for (let j = 0; j < FFT_SIZE; j++) fftInput[j] = (fftInput[j] - mean) * hann[j];

        const result = fftProcessor.forward(fftInput);
        if (!FFT[key] || FFT[key].length !== result.length) {
            FFT[key] = new Float32Array(result.length);
            FFT[dbKey] = new Float32Array(result.length);
            FFT[pkKey] = new Float32Array(result.length);
        }
        FFT[key].set(result);

        // dB 转换：mag → 20*log10(mag)，钳到 [dbFloor, dbCeil]。
        // 满幅正弦 mag≈0.5 → -6dB；加 3dB 修正使满幅≈-3dB。
        // 计算 20*log10 时用 sqrt+log 避免频繁 pow。
        const len = result.length;
        if (!_dbTemp || _dbTemp.length !== len) _dbTemp = new Float32Array(len);
        const dbArr = _dbTemp;
        for (let j = 0; j < len; j++) {
            let v = 20 * Math.log10(result[j] + 1e-10) + 3;
            dbArr[j] = v > dbCeil ? dbCeil : (v < dbFloor ? dbFloor : v);
        }

        // 时间平滑：db = smoothing*old + (1-smoothing)*new（指数加权）。
        // smoothing 大 → 更平滑但响应慢；小 → 敏捷但有跳变。
        const curDb = FFT[dbKey];
        for (let j = 0; j < len; j++) {
            curDb[j] = smoothing * curDb[j] + (1 - smoothing) * dbArr[j];
        }

        // 峰值保持：新值更高则立即更新，否则缓慢衰减。
        // 衰减速率 FFT_PEAK_DECAY dB/秒，按帧间隔折算。
        if (FFT.showPeaks) {
            const peak = FFT[pkKey];
            if (!_peakTemp || _peakTemp.length !== len) _peakTemp = new Float32Array(len);
            const peakArr = _peakTemp;
            const decayStep = RENDER.FFT_PEAK_DECAY * (1 / 60); // 每帧衰减量 (~60fps)
            for (let j = 0; j < len; j++) {
                const decayed = peak[j] - decayStep;              // 峰值线本身缓慢下落
                peakArr[j] = curDb[j] > decayed ? curDb[j] : (decayed > dbFloor ? decayed : dbFloor);
            }
            FFT[pkKey].set(peakArr);
        } else {
            // 关闭峰值保持时，峰值线直接跟随当前频谱（或隐藏，由渲染端决定）
            if (FFT[pkKey].length !== len) FFT[pkKey] = new Float32Array(len);
            FFT[pkKey].set(curDb);
        }
    }
}

export function updateMeasurements(ch1Raw, ch2Raw, ch3Raw, ch4Raw, ch5Raw, ch6Raw, ch7Raw, ch8Raw, viewRange) {
    const rawArrays = [ch1Raw, ch2Raw, ch3Raw, ch4Raw, ch5Raw, ch6Raw, ch7Raw, ch8Raw];
    if (!STATE.measure && !(STATE.fft && STATE.fft.on)) return;

    const sampleRate = Math.max(1, STATE.current?.sampleRate || CONFIG.sampleRate || 1);
    const length = rawArrays[0]?.length || 0;
    let startIdx = 0;
    let endIdx = Math.min(MEASUREMENT.SCAN_LENGTH, length);
    if (viewRange && Number.isFinite(viewRange.startIdx) && Number.isFinite(viewRange.endIdx)) {
        startIdx = Math.max(0, Math.min(length, Math.floor(viewRange.startIdx)));
        endIdx = Math.max(startIdx, Math.min(length, Math.ceil(viewRange.endIdx)));
    }

    if (STATE.measure) {
        for (let i = 0; i < CHANNEL_COUNT; i++) {
            const ch = i + 1;
            const row = document.getElementById(`meas-ch${ch}-row`);
            if (row) row.style.display = STATE[`ch${ch}`]?.on ? '' : 'none';
            if (!STATE[`ch${ch}`]?.on) continue;
            const result = measureChannel(rawArrays[i], startIdx, endIdx, sampleRate, STATE[`ch${ch}`]?.cpl);
            updateMeasurementDom(ch, result);
        }
    }

    updateFft(rawArrays);
}

export function updateMathData(mathState, raw1, raw2, raw3, raw4, raw5, raw6, raw7, raw8) {
    if (!mathState || !mathState.enabled) return;

    const rawData = [raw1, raw2, raw3, raw4, raw5, raw6, raw7, raw8];
    const len = raw1 ? raw1.length : 0;
    if (len === 0) return;

    if (!mathState.data || mathState.data.length !== len) {
        mathState.data = new Float32Array(len);
    }
    const out = mathState.data;
    const op = mathState.operation;

    const srcA = Math.max(0, Math.min(CHANNEL_COUNT - 1, (mathState.srcA || 1) - 1));
    const srcB = Math.max(0, Math.min(CHANNEL_COUNT - 1, (mathState.srcB || 2) - 1));
    const arrA = rawData[srcA];
    const arrB = rawData[srcB];
    if (!arrA) return;

    const sampleRate = Math.max(1, STATE.current?.sampleRate || CONFIG.sampleRate || 1);
    const dt = 1 / sampleRate;
    let unit = 'V';

    switch (op) {
        case 'add':
            for (let i = 0; i < len; i++) out[i] = arrA[i] + (arrB ? arrB[i] : 0);
            unit = 'V';
            break;
        case 'sub':
            for (let i = 0; i < len; i++) out[i] = arrA[i] - (arrB ? arrB[i] : 0);
            unit = 'V';
            break;
        case 'mul':
            for (let i = 0; i < len; i++) out[i] = arrA[i] * (arrB ? arrB[i] : 0);
            unit = 'V^2';
            break;
        case 'div':
            for (let i = 0; i < len; i++) out[i] = (arrB && Math.abs(arrB[i]) > 1e-10) ? arrA[i] / arrB[i] : 0;
            unit = 'ratio';
            break;
        case 'deriv':
            out[0] = 0;
            for (let i = 1; i < len; i++) out[i] = (arrA[i] - arrA[i - 1]) / dt;
            unit = 'V/s';
            break;
        case 'integ': {
            let acc = 0;
            out[0] = 0;
            for (let i = 1; i < len; i++) {
                acc += ((arrA[i - 1] + arrA[i]) * 0.5) * dt;
                out[i] = acc;
            }
            unit = 'V*s';
            break;
        }
        default:
            out.fill(0);
            unit = '';
            break;
    }

    let maxAbs = 0;
    for (let i = 0; i < len; i++) {
        const value = out[i];
        if (Number.isFinite(value)) maxAbs = Math.max(maxAbs, Math.abs(value));
        else out[i] = 0;
    }

    mathState.unit = unit;
    mathState.srcALabel = `CH${srcA + 1}`;
    mathState.srcBLabel = `CH${srcB + 1}`;
    mathState.displayScale = maxAbs > 1e-12 ? 0.75 / maxAbs : 1;
    mathState.displayPos = 0;
}