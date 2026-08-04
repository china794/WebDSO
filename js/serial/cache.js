/**
 * ==========================================
 * 串口缓存模块 — 多级降采样缓存 (Serial Cache)
 * ==========================================
 * 将环形缓冲区的原始数据压缩为多级缓存，
 * 以峰值保持算法保证波形细节。
 */

import { CHANNEL_COUNT } from '../core.js';

export const CACHE_LEVELS = 4;

/**
 * 初始化多级缓存
 * @param {number} ringSize - 环形缓冲区大小
 * @returns {Array} 缓存数组
 */
export function initCache(ringSize) {
    const levels = [];
    for (let level = 0; level < CACHE_LEVELS; level++) {
        const size = Math.max(1, Math.floor(ringSize / Math.pow(10, level + 1)));
        const cache = { min: new Float32Array(size), max: new Float32Array(size), valid: false };
        for (let ch = 1; ch <= CHANNEL_COUNT; ch++) {
            cache['ch' + ch + 'Min'] = new Float32Array(size);
            cache['ch' + ch + 'Max'] = new Float32Array(size);
        }
        levels.push(cache);
    }
    return { levels, valid: false };
}

/**
 * 计算多级降采样缓存
 * @param {Object} cacheState - 缓存状态 (含 levels, valid)
 * @param {Object} ringChannels - 环形缓冲区对象 { ring1, ring2, ..., ring8 }
 * @param {number} ringSize - 缓冲区大小
 */
export function updateCache(cacheState, ringChannels, ringSize) {
    const { levels } = cacheState;
    if (!levels || levels.length === 0) return;

    for (let level = 0; level < levels.length; level++) {
        const cache = levels[level];
        const blockSize = Math.pow(10, level + 1);
        const outSize = Math.floor(ringSize / blockSize);

        for (let ch = 1; ch <= CHANNEL_COUNT; ch++) {
            const ring = ringChannels['ring' + ch];
            const minArr = cache['ch' + ch + 'Min'];
            const maxArr = cache['ch' + ch + 'Max'];

            for (let i = 0; i < outSize; i++) {
                const start = i * blockSize;
                const end = Math.min(start + blockSize, ringSize);
                let minVal = ring[start];
                let maxVal = ring[start];
                for (let j = start + 1; j < end; j++) {
                    const v = ring[j];
                    if (v < minVal) minVal = v;
                    if (v > maxVal) maxVal = v;
                }
                minArr[i] = minVal;
                maxArr[i] = maxVal;
            }
        }
    }
    cacheState.valid = true;
}

/**
 * 获取指定范围的降采样数据
 * @param {Object} cacheState - 缓存状态
 * @param {number} startIdx - 起始索引
 * @param {number} endIdx - 结束索引
 * @param {Float32Array} output - 输出数组
 * @param {number} channel - 通道号 (1-8)
 * @param {Object} ringChannels - 环形缓冲区对象
 * @param {number} ringSize - 缓冲区大小
 */
export function getDownsampledData(cacheState, startIdx, endIdx, output, channel, ringChannels, ringSize) {
    const { levels } = cacheState;
    if (!cacheState.valid || !levels || levels.length === 0) {
        const ring = ringChannels['ring' + channel];
        output.set(ring.subarray(startIdx, endIdx));
        return;
    }

    const outLen = output.length;
    const range = endIdx - startIdx;
    const ratio = range / outLen;

    let level = 0;
    if (ratio > 1000) level = 3;
    else if (ratio > 100) level = 2;
    else if (ratio > 10) level = 1;

    const cache = levels[level];
    const blockRatio = Math.pow(10, level + 1);
    const maxArr = cache['ch' + channel + 'Max'];

    for (let i = 0; i < outLen; i++) {
        const globalIdx = startIdx + i;
        const cacheIdx = Math.floor(globalIdx / blockRatio);
        output[i] = cacheIdx < maxArr.length ? maxArr[cacheIdx] : 0;
    }
}
