// 🚀 确保 CONFIG, CACHE, DOM 这三个对象都被引入！
import { STATE, Buffers, CONFIG, CACHE, DOM } from './core.js';
import { FFT } from './lib/fft.js';

const FFT_SIZE = 8192; 
const fftProcessor = new FFT(FFT_SIZE);

export function findTriggerIndex(data, ptsNeeded, offset, targetLevel) {
    const dir = STATE.trigger.edge, hys = 0.02;
    let searchEnd = Math.floor(CONFIG.fftSize / 2) + 2000;
    let searchStart = 1000;
    if (searchEnd <= searchStart || searchEnd >= CONFIG.fftSize) return -1;
    for (let i = searchEnd - 1; i >= searchStart; i--) {
        let curr = data[i], prev = data[i - 1];
        if (dir === 1 && prev < targetLevel && curr >= targetLevel) {
            let isReal = false;
            for (let j = i - 1; j >= Math.max(0, i - 16000); j--) { if (data[j] <= targetLevel - hys) { isReal = true; break; } if (data[j] >= targetLevel) break; }
            if (isReal) return (i - 1) + (curr - prev !== 0 ? (targetLevel - prev) / (curr - prev) : 0);
        }
        if (dir === -1 && prev > targetLevel && curr <= targetLevel) {
            let isReal = false;
            for (let j = i - 1; j >= Math.max(0, i - 16000); j--) { if (data[j] >= targetLevel + hys) { isReal = true; break; } if (data[j] <= targetLevel) break; }
            if (isReal) return (i - 1) + (curr - prev !== 0 ? (targetLevel - prev) / (curr - prev) : 0);
        }
    }
    return -1;
}

export function processData(rawArray, stateObj, out) {
    if (stateObj.cpl === 'GND') { out.fill(0); return; }
    const ndcPerDiv = 2.0 / CONFIG.gridY;
    for (let i = 0; i < rawArray.length; i++) {
        out[i] = rawArray[i] * stateObj.scale * ndcPerDiv + stateObj.pos;
    }
}

export function updateMeasurements(ch1Raw, ch2Raw) {
    // 🚀 修复1：如果测量和频谱都没开，才直接退出以节省性能
    if (!STATE.measure && !(STATE.fft && STATE.fft.on)) return;

    const currentRate = (STATE.current && STATE.current.sampleRate) ? STATE.current.sampleRate : CONFIG.sampleRate;

    // ==========================================
    // 模块 A：仅当开启【测量】时执行
    // ==========================================
    if (STATE.measure) {
        const scanLen = 8000;
        const calc = (arr, cpl) => {
            let max = -999, min = 999, crossings = 0, offset = 0;
            if (cpl === 'AC') {
                let sum = 0; 
                for (let i = 0; i < scanLen && i < arr.length; i++) sum += arr[i]; 
                offset = sum / scanLen;
            }
            let prevVal = arr[0] - offset;
            for (let i = 1; i < scanLen && i < arr.length; i++) {
                let val = arr[i] - offset;
                if (val > max) max = val;
                if (val < min) min = val;
                if (prevVal < 0 && val >= 0) crossings++;
                prevVal = val;
            }
            return {
                vpp: (max === -999) ? '0.00 V' : (max - min).toFixed(2) + ' V',
                freq: crossings > 1 ? (crossings * (currentRate / scanLen)).toFixed(0) + ' Hz' : '0 Hz'
            };
        };

        const r1 = calc(ch1Raw, STATE.ch1.cpl);
        const r2 = calc(ch2Raw, STATE.ch2.cpl);

        if (CACHE.mCh1Vpp !== r1.vpp) { DOM.measCh1Vpp.innerText = r1.vpp; CACHE.mCh1Vpp = r1.vpp; }
        if (CACHE.mCh1Freq !== r1.freq) { DOM.measCh1Freq.innerText = r1.freq; CACHE.mCh1Freq = r1.freq; }
        if (CACHE.mCh2Vpp !== r2.vpp) { DOM.measCh2Vpp.innerText = r2.vpp; CACHE.mCh2Vpp = r2.vpp; }
        if (CACHE.mCh2Freq !== r2.freq) { DOM.measCh2Freq.innerText = r2.freq; CACHE.mCh2Freq = r2.freq; }
    }

    // ==========================================
    // 模块 B：仅当开启【频谱】时执行（不再受测量按钮限制）
    // ==========================================
    if (STATE.fft && STATE.fft.on) {
        // 取最后 8192 个点分析
        const sampleSegment = ch1Raw.slice(-FFT_SIZE);
        const result = fftProcessor.forward(sampleSegment);
        
        // 🚀 自动给 buffer 扩容，以接住 4096 个超清频点
        if (STATE.fft.buffer.length !== result.length) {
            STATE.fft.buffer = new Float32Array(result.length);
        }
        STATE.fft.buffer.set(result);
    }
}