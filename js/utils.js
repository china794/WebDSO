/**
 * ==========================================
 * 工具函数模块 (Utilities)
 * ==========================================
 * 提供通用的工具函数，减少代码重复
 */

/**
 * 遍历所有通道
 * @param {Function} callback - 回调函数 (id, channelState, dataBuffer, processedBuffer) => void
 * @param {Object} STATE - 全局状态对象
 * @param {Object} Buffers - 数据缓冲区对象
 * @param {number} CHANNEL_COUNT - 通道数量
 */
export function forEachChannel(callback, STATE, Buffers, CHANNEL_COUNT = 8) {
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        const id = i;
        const state = STATE[`ch${id}`];
        const rawData = Buffers[`data${id}`];
        const processedData = Buffers[`pData${id}`];
        callback(id, state, rawData, processedData);
    }
}

/**
 * 遍历开启的通道
 * @param {Function} callback - 回调函数 (id, channelState, dataBuffer, processedBuffer) => void
 * @param {Object} STATE - 全局状态对象
 * @param {Object} Buffers - 数据缓冲区对象
 * @param {number} CHANNEL_COUNT - 通道数量
 */
export function forEachActiveChannel(callback, STATE, Buffers, CHANNEL_COUNT = 8) {
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        const id = i;
        const state = STATE[`ch${id}`];
        if (state && state.on) {
            const rawData = Buffers[`data${id}`];
            const processedData = Buffers[`pData${id}`];
            callback(id, state, rawData, processedData);
        }
    }
}

/**
 * 获取开启的通道数量
 * @param {Object} STATE - 全局状态对象
 * @param {number} CHANNEL_COUNT - 通道数量
 * @returns {number}
 */
export function getActiveChannelCount(STATE, CHANNEL_COUNT = 8) {
    let count = 0;
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        if (STATE[`ch${i}`]?.on) count++;
    }
    return count;
}

/**
 * 批量更新通道按钮状态
 * @param {Object} DOM - DOM 缓存对象
 * @param {Object} STATE - 全局状态对象
 * @param {number} CHANNEL_COUNT - 通道数量
 */
export function updateChannelToggleButtons(DOM, STATE, CHANNEL_COUNT = 8) {
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        const btn = DOM[`ch${i}Toggle`];
        if (btn) {
            btn.classList.toggle('active', STATE[`ch${i}`]?.on);
        }
    }
}

/**
 * 格式化频率显示
 * @param {number} freq - 频率值(Hz)
 * @returns {string}
 */
export function formatFrequency(freq) {
    if (freq >= 1000000) {
        return (freq / 1000000).toFixed(2) + ' MHz';
    } else if (freq >= 1000) {
        return (freq / 1000).toFixed(2) + ' kHz';
    }
    return freq.toFixed(0) + ' Hz';
}

/**
 * 格式化电压显示
 * @param {number} voltage - 电压值(V)
 * @returns {string}
 */
export function formatVoltage(voltage) {
    if (Math.abs(voltage) >= 1000) {
        return (voltage / 1000).toFixed(2) + ' kV';
    } else if (Math.abs(voltage) < 0.001) {
        return (voltage * 1000).toFixed(2) + ' mV';
    }
    return voltage.toFixed(2) + ' V';
}

/**
 * 格式化时间显示
 * @param {number} seconds - 时间(秒)
 * @returns {string}
 */
export function formatTime(seconds) {
    if (seconds >= 1) {
        return seconds.toFixed(2) + ' s';
    } else if (seconds >= 0.001) {
        return (seconds * 1000).toFixed(2) + ' ms';
    } else if (seconds >= 0.000001) {
        return (seconds * 1000000).toFixed(2) + ' μs';
    }
    return (seconds * 1000000000).toFixed(2) + ' ns';
}

/**
 * 将十六进制颜色转换为 RGB 数组
 * @param {string} hex - 十六进制颜色 (#RRGGBB)
 * @returns {number[]} [r, g, b]
 */
export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ] : [0, 0, 0];
}

/**
 * 将十六进制颜色转换为 RGBA 字符串
 * @param {string} hex - 十六进制颜色
 * @param {number} alpha - 透明度 (0-1)
 * @returns {string}
 */
export function hexToRgba(hex, alpha = 1) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间(ms)
 * @returns {Function}
 */
export function debounce(func, wait = 100) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 节流函数
 * @param {Function} func - 要节流的函数
 * @param {number} limit - 限制时间(ms)
 * @returns {Function}
 */
export function throttle(func, limit = 100) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * 深拷贝对象
 * @param {Object} obj - 要拷贝的对象
 * @returns {Object}
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (obj instanceof Object) {
        const cloned = {};
        Object.keys(obj).forEach(key => {
            cloned[key] = deepClone(obj[key]);
        });
        return cloned;
    }
    return obj;
}

/**
 * 安全地获取嵌套对象属性
 * @param {Object} obj - 对象
 * @param {string} path - 属性路径 (如 'a.b.c')
 * @param {*} defaultValue - 默认值
 * @returns {*}
 */
export function getNestedValue(obj, path, defaultValue = undefined) {
    const keys = path.split('.');
    let result = obj;
    for (const key of keys) {
        if (result === null || result === undefined || !(key in result)) {
            return defaultValue;
        }
        result = result[key];
    }
    return result;
}

/**
 * 安全地设置嵌套对象属性
 * @param {Object} obj - 对象
 * @param {string} path - 属性路径
 * @param {*} value - 值
 */
export function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in current) || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}

/**
 * 生成唯一ID
 * @returns {string}
 */
export function generateId() {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
}

/**
 * 下载 JSON 文件
 * @param {Object} data - 数据对象
 * @param {string} filename - 文件名
 */
export function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 读取 JSON 文件
 * @param {File} file - 文件对象
 * @returns {Promise<Object>}
 */
export function readJsonFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                resolve(JSON.parse(e.target.result));
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

/**
 * 检查值是否在范围内
 * @param {number} value - 值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {boolean}
 */
export function inRange(value, min, max) {
    return value >= min && value <= max;
}

/**
 * 将值限制在范围内
 * @param {number} value - 值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number}
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * 线性插值
 * @param {number} start - 起始值
 * @param {number} end - 结束值
 * @param {number} t - 插值因子 (0-1)
 * @returns {number}
 */
export function lerp(start, end, t) {
    return start + (end - start) * t;
}

/**
 * 平滑插值
 * @param {number} start - 起始值
 * @param {number} end - 结束值
 * @param {number} t - 插值因子 (0-1)
 * @returns {number}
 */
export function smoothStep(start, end, t) {
    t = clamp((t - start) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
}
