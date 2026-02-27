import { STATE, Buffers, CONFIG, CACHE, DOM } from './core.js';
import { FFT } from './lib/fft.js';

// ==========================================
// 信号处理与分析模块 (Signal Processing)
// ==========================================

const FFT_SIZE = 32768; 
const fftProcessor = new FFT(FFT_SIZE);

/**
 * 寻找触发器 (Trigger) 的水平断点索引
 * 用于稳定波形显示，防止波形在屏幕上乱跑
 * * @param {Float32Array} data - 输入的波形数据数组
 * @param {number} ptsNeeded - 视口需要显示的采样点数
 * @param {number} offset - 搜索偏移量 (当前未使用，预留参数)
 * @param {number} targetLevel - 设定的触发电平 (映射后的 NDC 坐标)
 * @returns {number} 触发点的浮点索引位置，未找到则返回 -1
 */
export function findTriggerIndex(data, ptsNeeded, offset, targetLevel) {
    const dir = STATE.trigger.edge;
    const hys = 0.02; // 滞回区间(Hysteresis)，防止噪声导致错误触发
    
    // 设定搜索区间，优先从中间偏右开始向前搜索
    let searchEnd = Math.floor(CONFIG.fftSize / 2) + 2000;
    let searchStart = 1000;
    
    if (searchEnd <= searchStart || searchEnd >= CONFIG.fftSize) {
        return -1;
    }
    
    for (let i = searchEnd - 1; i >= searchStart; i--) {
        let curr = data[i];
        let prev = data[i - 1];
        
        // 检测上升沿
        if (dir === 1 && prev < targetLevel && curr >= targetLevel) {
            let isReal = false;
            for (let j = i - 1; j >= Math.max(0, i - 16000); j--) { 
                if (data[j] <= targetLevel - hys) { 
                    isReal = true; 
                    break; 
                } 
                if (data[j] >= targetLevel) break; 
            }
            if (isReal) {
                return (i - 1) + (curr - prev !== 0 ? (targetLevel - prev) / (curr - prev) : 0);
            }
        }
        
        // 检测下降沿
        if (dir === -1 && prev > targetLevel && curr <= targetLevel) {
            let isReal = false;
            for (let j = i - 1; j >= Math.max(0, i - 16000); j--) { 
                if (data[j] >= targetLevel + hys) { 
                    isReal = true; 
                    break; 
                } 
                if (data[j] <= targetLevel) break; 
            }
            if (isReal) {
                return (i - 1) + (curr - prev !== 0 ? (targetLevel - prev) / (curr - prev) : 0);
            }
        }
    }
    
    return -1;
}

/**
 * 将原始采集数据归一化为 NDC (标准化设备坐标系)
 * @param {Float32Array} rawArray - 原始数据源
 * @param {Object} stateObj - 通道的状态配置 (包含 scale, pos, cpl)
 * @param {Float32Array} out - 转换后输出的数组
 */
export function processData(rawArray, stateObj, out) {
    if (stateObj.cpl === 'GND') { 
        out.fill(0); 
        return; 
    }
    
    const ndcPerDiv = 2.0 / CONFIG.gridY;
    
    for (let i = 0; i < rawArray.length; i++) {
        out[i] = rawArray[i] * stateObj.scale * ndcPerDiv + stateObj.pos;
    }
}

/**
 * 实时更新测量数据 (Vpp, Freq) 并执行 FFT 频谱分析
 * @param {Float32Array} ch1Raw - CH1 通道原始数据
 * @param {Float32Array} ch2Raw - CH2 通道原始数据
 */
export function updateMeasurements(ch1Raw, ch2Raw) {
    // 如果测量面板和频谱分析都没开，直接退出
    if (!STATE.measure && !(STATE.fft && STATE.fft.on)) return;

    const currentRate = (STATE.current && STATE.current.sampleRate) ? STATE.current.sampleRate : CONFIG.sampleRate;

    // ==========================================
    // 模块 A：基础参数测量 (Vpp & Frequency)
    // 仅当开启【测量】时执行
    // ==========================================
    if (STATE.measure) {
        const scanLen = 8000;
        
        const calc = (arr, cpl) => {
            let max = -999;
            let min = 999;
            let crossings = 0;
            let offset = 0;
            
            // 处理 AC 耦合的直流偏置滤除
            if (cpl === 'AC') {
                let sum = 0; 
                for (let i = 0; i < scanLen && i < arr.length; i++) {
                    sum += arr[i];
                }
                offset = sum / scanLen;
            }
            
            let prevVal = arr[0] - offset;
            
            for (let i = 1; i < scanLen && i < arr.length; i++) {
                let val = arr[i] - offset;
                
                if (val > max) max = val;
                if (val < min) min = val;
                
                // 零点交叉检测 (用于简易频率计算)
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

        // 缓存优化：仅当数值发生变化时才操作 DOM
        if (CACHE.mCh1Vpp !== r1.vpp) { 
            DOM.measCh1Vpp.innerText = r1.vpp; 
            CACHE.mCh1Vpp = r1.vpp; 
        }
        if (CACHE.mCh1Freq !== r1.freq) { 
            DOM.measCh1Freq.innerText = r1.freq; 
            CACHE.mCh1Freq = r1.freq; 
        }
        if (CACHE.mCh2Vpp !== r2.vpp) { 
            DOM.measCh2Vpp.innerText = r2.vpp; 
            CACHE.mCh2Vpp = r2.vpp; 
        }
        if (CACHE.mCh2Freq !== r2.freq) { 
            DOM.measCh2Freq.innerText = r2.freq; 
            CACHE.mCh2Freq = r2.freq; 
        }
    }

    // ==========================================
    // 模块 B：高级频谱分析 (FFT)
    // 双通道并行处理，独立于测量面板运行
    // ==========================================
    if (STATE.fft && STATE.fft.on) {
        
        // CH1 通道 FFT 计算
        if (STATE.ch1.on) {
            const sampleSegment1 = ch1Raw.slice(-FFT_SIZE);
            const result1 = fftProcessor.forward(sampleSegment1);
            
            // 动态扩容缓冲池以适配新的精度
            if (STATE.fft.buffer1.length !== result1.length) {
                STATE.fft.buffer1 = new Float32Array(result1.length);
            }
            STATE.fft.buffer1.set(result1);
        }
        
        // CH2 通道 FFT 计算
        if (STATE.ch2.on) {
            const sampleSegment2 = ch2Raw.slice(-FFT_SIZE);
            const result2 = fftProcessor.forward(sampleSegment2);
            
            // 动态扩容缓冲池以适配新的精度
            if (STATE.fft.buffer2.length !== result2.length) {
                STATE.fft.buffer2 = new Float32Array(result2.length);
            }
            STATE.fft.buffer2.set(result2);
        }
    }
}