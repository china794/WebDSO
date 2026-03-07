import { STATE, Buffers, CONFIG, CACHE, DOM, CHANNEL_COUNT } from './core.js';
import { FFT } from './lib/fft.js';
import { BUFFER, TRIGGER, MEASUREMENT, GRID } from './constants.js';

/**
 * ==========================================
 * 信号处理与分析模块 (Signal Processing)
 * ==========================================
 * 功能：
 * - 触发点搜索 (findTriggerIndex)
 * - 原始数据归一化 (processData)
 * - 测量与 FFT 频谱 (updateMeasurements)
 */

const FFT_SIZE = BUFFER.FFT_SIZE;
const fftProcessor = new FFT(FFT_SIZE);

/**
 * 寻找触发器 (Trigger) 的水平断点索引
 * 用于稳定波形显示，防止波形在屏幕上乱跑
 * @param {Float32Array} data - 输入的波形数据数组
 * @param {number} ptsNeeded - 视口需要显示的采样点数
 * @param {number} offset - 搜索偏移量 (当前未使用，预留参数)
 * @param {number} targetLevel - 设定的触发电平 (映射后的 NDC 坐标)
 * @returns {number} 触发点的浮点索引位置，未找到则返回 -1
 */
export function findTriggerIndex(data, ptsNeeded, offset, targetLevel) {
    const dir = STATE.trigger.edge;
    const hys = TRIGGER.HYSTERESIS; // 滞回区间(Hysteresis)，防止噪声导致错误触发

    // 根据当前模式选择缓冲区大小
    const bufferSize = STATE.current.isSerial ? BUFFER.SERIAL_FFT_SIZE : CONFIG.fftSize;
    
    // 设定搜索区间，优先从中间偏右开始向前搜索
    let searchEnd = Math.floor(bufferSize / 2) + TRIGGER.SEARCH_END_OFFSET;
    let searchStart = TRIGGER.SEARCH_START;

    if (searchEnd <= searchStart || searchEnd >= bufferSize) {
        return -1;
    }
    
    for (let i = searchEnd - 1; i >= searchStart; i--) {
        let curr = data[i];
        let prev = data[i - 1];
        
        // 检测上升沿
        if (dir === 1 && prev < targetLevel && curr >= targetLevel) {
            let isReal = false;
            for (let j = i - 1; j >= Math.max(0, i - TRIGGER.HISTORY_DEPTH); j--) {
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
            for (let j = i - 1; j >= Math.max(0, i - TRIGGER.HISTORY_DEPTH); j--) {
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
 * 简单的高通滤波器（用于AC耦合）
 * 模拟音频模式中的BiquadFilter highpass
 * @param {Float32Array} input - 输入数据
 * @param {Float32Array} output - 输出数据
 * @param {number} cutoff - 截止频率（归一化，0-1）
 */
function highpassFilter(input, output, cutoff) {
    const rc = 1.0 / (2.0 * Math.PI * cutoff);
    const dt = 1.0;
    const alpha = rc / (rc + dt);
    
    let y = input[0]; // 初始值
    output[0] = y;
    
    for (let i = 1; i < input.length; i++) {
        y = alpha * (y + input[i] - input[i - 1]);
        output[i] = y;
    }
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
    
    const ndcPerDiv = GRID.NDC_PER_DIV;
    
    // AC耦合：使用高通滤波器去除直流分量（类似音频模式）
    if (stateObj.cpl === 'AC') {
        // 使用简单的高通滤波，截止频率对应10Hz（与音频模式一致）
        // 归一化截止频率 = 10Hz / 采样率，限制在有效范围(0, 1)内
        const sampleRate = STATE.current.sampleRate || CONFIG.sampleRate;
        const cutoffNorm = Math.min(0.99, Math.max(0.01, 10 / sampleRate));
        highpassFilter(rawArray, out, cutoffNorm);
        
        // 应用scale和pos
        for (let i = 0; i < out.length; i++) {
            out[i] = out[i] * stateObj.scale * ndcPerDiv + stateObj.pos;
        }
    } else {
        // DC耦合：直接复制
        for (let i = 0; i < rawArray.length; i++) {
            out[i] = rawArray[i] * stateObj.scale * ndcPerDiv + stateObj.pos;
        }
    }
}

/**
 * 实时更新测量数据 (Vpp, Vmax, Vmin, Vavg, Freq) 并执行 FFT 频谱分析
 * @param {...Float32Array} rawArrays - 各通道原始数据 (CH1-CH8)
 * @param {Object} viewRange - 当前视角范围 {startIdx, endIdx}
 */
export function updateMeasurements(ch1Raw, ch2Raw, ch3Raw, ch4Raw, ch5Raw, ch6Raw, ch7Raw, ch8Raw, viewRange) {
    const rawArrays = [ch1Raw, ch2Raw, ch3Raw, ch4Raw, ch5Raw, ch6Raw, ch7Raw, ch8Raw];
    // 如果测量面板和频谱分析都没开，直接退出
    if (!STATE.measure && !(STATE.fft && STATE.fft.on)) return;

    const currentRate = (STATE.current && STATE.current.sampleRate) ? STATE.current.sampleRate : CONFIG.sampleRate;

    // ==========================================
    // 模块 A：基础参数测量 (Vpp, Vmax, Vmin, Vavg, Frequency)
    // ==========================================
    if (STATE.measure) {
        // 使用当前视角范围或默认扫描长度
        let startIdx = 0, endIdx;
        if (viewRange && viewRange.startIdx !== undefined && viewRange.endIdx !== undefined) {
            startIdx = Math.max(0, viewRange.startIdx);
            endIdx = Math.min(rawArrays[0]?.length || 0, viewRange.endIdx);
        } else {
            endIdx = Math.min(MEASUREMENT.SCAN_LENGTH, rawArrays[0]?.length || 0);
        }
        const scanLen = endIdx - startIdx;
        
        const calc = (arr, cpl, scale) => {
            if (!arr || scanLen <= 0) return { vpp: '0.00 V', vmax: '0.00 V', vmin: '0.00 V', vavg: '0.00 V', freq: '0 Hz' };
            
            let max = -Infinity;
            let min = Infinity;
            let sum = 0;
            let offset = 0;
            
            // 1. 处理 AC 耦合的直流偏置滤除
            if (cpl === 'AC') {
                let tempSum = 0; 
                for (let i = startIdx; i < endIdx && i < arr.length; i++) {
                    tempSum += arr[i];
                }
                offset = tempSum / scanLen;
            }
            
            // 2. 扫描基础数据：找到最大值、最小值和总和
            for (let i = startIdx; i < endIdx && i < arr.length; i++) {
                let val = arr[i] - offset;
                if (val > max) max = val;
                if (val < min) min = val;
                sum += val;
            }
            
            const avg = sum / scanLen;
            const vppRaw = (max === -Infinity || min === Infinity) ? 0 : (max - min);
            
            // ==========================================
            // 3. 智能频率计算模块 (自适应阈值 + 双重算法)
            // ==========================================
            let freqValue = 0;
            
            // 过滤底噪：只有当信号峰峰值大于 0.02V 时才认为有周期性频率
            if (vppRaw > 0.02) { 
                // [自适应阈值计算]
                let mid = (max + min) / 2;      // 自动找到波形的真正中间线
                let hys = vppRaw * 0.1;         // 10% Vpp 的动态滞回抗噪区间
                let threshHigh = mid + hys;     // 上限
                let threshLow = mid - hys;      // 下限
                
                let isHigh = (arr[startIdx] - offset) > mid;
                let edges = []; // 记录上升沿的精确索引
                
                // 扫描波形寻找精确过零点
                for (let i = startIdx; i < endIdx && i < arr.length; i++) {
                    let val = arr[i] - offset;
                    if (isHigh && val < threshLow) {
                        isHigh = false;
                    } else if (!isHigh && val > threshHigh) {
                        isHigh = true;
                        edges.push(i); // 记录每一次真实上升沿的刻度
                    }
                }
                
                if (edges.length >= 2) {
                    // 【方法 A：高精度零点交叉跨度法】
                    // 不仅仅是数次数，而是计算 (最后一个上升沿 - 首个上升沿) 的总时长
                    let numCycles = edges.length - 1;
                    let samplesBetween = edges[edges.length - 1] - edges[0];
                    let timeSpan = samplesBetween / currentRate;
                    freqValue = numCycles / timeSpan;
                } else {
                    // 【方法 B：周期峰谷估算法 (托底方案)】
                    // 当屏幕太短/频率太低，不足以形成两个完整周期时，根据最高点和最低点的距离估算
                    let maxIdx = startIdx;
                    let minIdx = startIdx;
                    for (let i = startIdx; i < endIdx && i < arr.length; i++) {
                        let val = arr[i] - offset;
                        if (val === max) maxIdx = i;
                        if (val === min) minIdx = i;
                    }
                    let halfPeriodSamples = Math.abs(maxIdx - minIdx);
                    // 确保峰谷之间有距离，防止除0
                    if (halfPeriodSamples > 0 && halfPeriodSamples < scanLen) {
                        let fullPeriodTime = (halfPeriodSamples * 2) / currentRate;
                        freqValue = 1 / fullPeriodTime;
                    }
                }
            }
            
            // 格式化输出电压
            const toVoltage = (v) => v.toFixed(2) + ' V';
            
            // 格式化输出频率 (只取整数)
            let freqStr = Math.round(freqValue) + ' Hz';
             
            return {
                vpp: vppRaw === 0 ? '0.00 V' : toVoltage(vppRaw),
                vmax: (max === -Infinity) ? '0.00 V' : toVoltage(max),
                vmin: (min === Infinity) ? '0.00 V' : toVoltage(min),
                vavg: toVoltage(avg),
                freq: freqStr
            };
        };

        for (let i = 0; i < CHANNEL_COUNT && rawArrays[i]; i++) {
            const n = i + 1;
            const chState = STATE['ch' + n];
            const measRow = DOM['measCh' + n + 'Row']; // 测量行容器

            // 只显示开启的频道
            if (!chState.on) {
                if (measRow) measRow.style.display = 'none';
                continue;
            }

            // 频道开启，显示并更新数据
            if (measRow) measRow.style.display = 'block';

            const r = calc(rawArrays[i], chState.cpl, chState.scale);
            
            // 更新所有测量值
            const updateMeas = (key, value, el) => {
                if (CACHE[key] !== value && el) { 
                    el.innerText = value; 
                    CACHE[key] = value; 
                }
            };
            
            updateMeas('mCh' + n + 'Vpp', r.vpp, DOM['measCh' + n + 'Vpp']);
            updateMeas('mCh' + n + 'Vmax', r.vmax, DOM['measCh' + n + 'Vmax']);
            updateMeas('mCh' + n + 'Vmin', r.vmin, DOM['measCh' + n + 'Vmin']);
            updateMeas('mCh' + n + 'Vavg', r.vavg, DOM['measCh' + n + 'Vavg']);
            updateMeas('mCh' + n + 'Freq', r.freq, DOM['measCh' + n + 'Freq']);
        }
    }

    // ==========================================
    // 模块 B：高级频谱分析 (FFT)
    // ==========================================
    if (STATE.fft && STATE.fft.on) {
        for (let i = 0; i < CHANNEL_COUNT && rawArrays[i]; i++) {
            const n = i + 1;
            if (STATE['ch' + n].on) {
                // 两种模式都使用FFT_SIZE（32768点）
                let seg;
                if (STATE.current.isSerial) {
                    // 串口模式：取最后FFT_SIZE个数据（最新的数据）
                    seg = rawArrays[i].slice(-FFT_SIZE);
                } else {
                    // 音频模式：取前FFT_SIZE个数据
                    seg = rawArrays[i].slice(0, FFT_SIZE);
                }
                
                const result = fftProcessor.forward(seg);
                const bufKey = 'buffer' + n;
                if (STATE.fft[bufKey].length !== result.length) {
                    STATE.fft[bufKey] = new Float32Array(result.length);
                }
                STATE.fft[bufKey].set(result);
            }
        }
    }
}