/**
 * ==========================================
 * 核心状态与全局配置模块 (Core System)
 * 负责管理系统全局状态、常量配置、DOM 映射与内存缓冲池
 * ==========================================
 */

/** 通道数量 */
export const CHANNEL_COUNT = 8;

/** 通道默认配置 (含内置信号发生器参数) */
const createChannelState = () => ({
    on: true, pos: 0, scale: 4.0, cpl: 'DC',
    genType: 'off', genFreq: 1000, genAmp: 0.5
});

/**
 * 全局状态树 (STATE)
 * 集中管理示波器运行时的所有可调参数与 UI 状态
 */
export const STATE = {
    power: true, 
    run: true, 
    mode: 'YT',
    ch1: { ...createChannelState(), on: true },
    ch2: { ...createChannelState(), on: true },
    ch3: { ...createChannelState(), on: false },
    ch4: { ...createChannelState(), on: false },
    ch5: { ...createChannelState(), on: false },
    ch6: { ...createChannelState(), on: false },
    ch7: { ...createChannelState(), on: false },
    ch8: { ...createChannelState(), on: false },
    awgOutL: 1,
    awgOutR: 2,
    serialOutL: 1,
    serialOutR: 2,
    hpos: 50, 
    secPerDiv: 5,
    trigger: { src: 'CH1', edge: 1, level: 0.0, enabled: false },
    measure: false, 
    awgMonitor: false,
    cursor: { mode: 0, v1: 0.25, v2: -0.25, t1: -0.25, t2: 0.25, dragging: null },
    hover: { active: false, x: 0, y: 0 },
    serial: {
        connected: false,
        baud: 115200,
        protocol: 'justfloat'
    },
    current: {
        sampleRate: 96000,
        isSerial: false,
        lineSize: 0.002
    },
    fft: { 
        on: false, 
        maxFreq: 8000,
        gain: 100,
        buffer1: new Float32Array(4096),
        buffer2: new Float32Array(4096),
        buffer3: new Float32Array(4096),
        buffer4: new Float32Array(4096),
        buffer5: new Float32Array(4096),
        buffer6: new Float32Array(4096),
        buffer7: new Float32Array(4096),
        buffer8: new Float32Array(4096)
    },
};

/**
 * 系统常量与动态色彩配置
 */
export const CONFIG = { 
    fftSize: 32768, 
    sampleRate: 96000, 
    gridX: 10, 
    gridY: 8, 
    
    get colors() {
        const isLight = document.body.getAttribute('data-theme') === 'light';
        return isLight ? {
            // --- 浅色模式 (Light Mode) --- 深色波形便于白底对比
            bg: [1.0, 1.0, 1.0, 1.0], 
            c1: [0.73, 0.11, 0.11],   c2: [0.11, 0.31, 0.85],   c3: [0.08, 0.50, 0.24],   c4: [0.75, 0.10, 0.36],
            c5: [0.76, 0.25, 0.05],   c6: [0.49, 0.13, 0.62],   c7: [0.40, 0.64, 0.04],   c8: [0.62, 0.07, 0.22],
            cM: [0.57, 0.20, 0.91],   cXY: [0.05, 0.6, 0.1],    
            
            grid: '#e4e4e7',          crosshair: '#a1a1aa',     trigger: 'rgba(234, 88, 12, 0.5)', 
            cursorY: '#9333ea',       cursorX: '#0284c7',       hoverBg: 'rgba(255, 255, 255, 0.9)', 
            hoverBorder: '#d4d4d8',   hoverText: '#18181b',     
            c1Hex: '#b91c1c', c2Hex: '#1d4ed8', c3Hex: '#15803d', c4Hex: '#be185d',
            c5Hex: '#c2410c', c6Hex: '#7e22ce', c7Hex: '#65a30d', c8Hex: '#9f1239',
            
            fftBg: 'rgba(244, 244, 245, 0.85)',
            fftC1: 'rgba(185, 28, 28, 0.95)', fftC2: 'rgba(29, 78, 216, 0.95)', fftC3: 'rgba(21, 128, 61, 0.95)',
            fftC4: 'rgba(190, 24, 93, 0.95)', fftC5: 'rgba(194, 65, 12, 0.95)', fftC6: 'rgba(126, 34, 206, 0.95)',
            fftC7: 'rgba(101, 163, 13, 0.95)', fftC8: 'rgba(159, 18, 57, 0.95)',
            fftTextDim: 'rgba(0, 0, 0, 0.4)', fftTextBright: '#16a34a', 
            
            miniTrace1: 'rgba(185, 28, 28, 0.8)', miniTrace2: 'rgba(29, 78, 216, 0.8)', miniTrace3: 'rgba(21, 128, 61, 0.8)',
            miniTrace4: 'rgba(190, 24, 93, 0.8)', miniTrace5: 'rgba(194, 65, 12, 0.8)', miniTrace6: 'rgba(126, 34, 206, 0.8)',
            miniTrace7: 'rgba(101, 163, 13, 0.8)', miniTrace8: 'rgba(159, 18, 57, 0.8)'
        } : {
            // --- 深色模式 --- 亮色波形便于黑底对比
            bg: [0.0, 0.0, 0.0, 1.0], 
            c1: [0.91, 0.7, 0.04],    c2: [0.02, 0.71, 0.83],   c3: [0.13, 0.77, 0.37],   c4: [0.93, 0.28, 0.60],
            c5: [0.98, 0.45, 0.02],   c6: [0.66, 0.33, 0.98],   c7: [0.52, 0.80, 0.05],   c8: [0.88, 0.12, 0.35],
            cM: [0.75, 0.51, 0.98],   cXY: [0.1, 1.0, 0.2],     
            
            grid: '#1e2920', crosshair: '#2d4a30', trigger: 'rgba(255, 165, 0, 0.4)',
            cursorY: '#a855f7', cursorX: '#38bdf8', hoverBg: 'rgba(10, 10, 12, 0.85)',
            hoverBorder: '#444', hoverText: '#ffffff',
            c1Hex: '#eab308', c2Hex: '#06b6d4', c3Hex: '#22c55e', c4Hex: '#ec4899',
            c5Hex: '#f97316', c6Hex: '#a855f7', c7Hex: '#84cc16', c8Hex: '#e11d48',
            
            fftBg: 'rgba(0, 30, 10, 0.6)',
            fftC1: 'rgba(234, 179, 8, 0.8)', fftC2: 'rgba(6, 182, 212, 0.8)', fftC3: 'rgba(34, 197, 94, 0.8)',
            fftC4: 'rgba(236, 72, 153, 0.8)', fftC5: 'rgba(249, 115, 22, 0.8)', fftC6: 'rgba(168, 85, 247, 0.8)',
            fftC7: 'rgba(132, 204, 22, 0.8)', fftC8: 'rgba(225, 29, 72, 0.8)',
            fftTextDim: 'rgba(255, 255, 255, 0.6)', fftTextBright: '#4ade80',
            
            miniTrace1: 'rgba(234,179,8,0.8)', miniTrace2: 'rgba(6,182,212,0.8)', miniTrace3: 'rgba(34,197,94,0.8)',
            miniTrace4: 'rgba(236,72,153,0.8)', miniTrace5: 'rgba(249,115,22,0.8)', miniTrace6: 'rgba(168,85,247,0.8)',
            miniTrace7: 'rgba(132,204,22,0.8)', miniTrace8: 'rgba(225,29,72,0.8)'
        };
    }
};

/** X-Y 模式下李萨如图形的采样点数 */
export const XY_PTS = 16384;
/** X-Y 模式下用于渐变透明度的查找表 (越新越亮) */
export const ALPHA_LUT = new Float32Array(XY_PTS);

for (let i = 0; i < XY_PTS; i++) {
    ALPHA_LUT[i] = Math.pow(i / XY_PTS, 30);
}

/** WebGL 顶点缓冲布局常量 (每顶点 20 字节: 2*float pos + 3*float data) */
export const GL_CONST = { 
    BYTES_PER_VERTEX: 20, 
    POS_OFFSET: 0, 
    DATA_OFFSET: 8 
};

/** 全局 DOM 引用表：将 id 转为驼峰命名并缓存 */
export const DOM = {};

document.querySelectorAll('[id]').forEach(el => {
    const camelCaseId = el.id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    DOM[camelCaseId] = el;
});

/** 渲染缓存：避免重复写 DOM 造成闪烁 */
export const CACHE = { 
    tStateTxt: '', tStateColor: '', 
    mCh1Vpp: '', mCh1Freq: '', mCh2Vpp: '', mCh2Freq: '', mCh3Vpp: '', mCh3Freq: '', mCh4Vpp: '', mCh4Freq: '',
    mCh5Vpp: '', mCh5Freq: '', mCh6Vpp: '', mCh6Freq: '', mCh7Vpp: '', mCh7Freq: '', mCh8Vpp: '', mCh8Freq: '',
    audioTimeStr: '', audioSeekVal: -1 
};

/** 共享数据缓冲池：原始数据、处理后数据、FFT 结果 */
export const Buffers = {
    data1: new Float32Array(CONFIG.fftSize), data2: new Float32Array(CONFIG.fftSize),
    data3: new Float32Array(CONFIG.fftSize), data4: new Float32Array(CONFIG.fftSize),
    data5: new Float32Array(CONFIG.fftSize), data6: new Float32Array(CONFIG.fftSize),
    data7: new Float32Array(CONFIG.fftSize), data8: new Float32Array(CONFIG.fftSize),
    pData1: new Float32Array(CONFIG.fftSize), pData2: new Float32Array(CONFIG.fftSize),
    pData3: new Float32Array(CONFIG.fftSize), pData4: new Float32Array(CONFIG.fftSize),
    pData5: new Float32Array(CONFIG.fftSize), pData6: new Float32Array(CONFIG.fftSize),
    pData7: new Float32Array(CONFIG.fftSize), pData8: new Float32Array(CONFIG.fftSize),
    fftResult: new Float32Array(CONFIG.fftSize / 2)
};

/**
 * 根据当前通道档位更新触发电平滑块的量程
 * 确保触发电平始终在有效范围内
 */
export const updateTriggerUI = () => {
    const src = STATE.trigger.src.toLowerCase();
    const ch = STATE[src];
    if (!ch) return;
    let vPerDiv = 1.0 / ch.scale;
    let range = 4.0 * vPerDiv;
    
    DOM.knobTlevel.min = -range; 
    DOM.knobTlevel.max = range; 
    DOM.knobTlevel.step = range / 100;
    
    STATE.trigger.level = Math.max(-range, Math.min(range, STATE.trigger.level));
    DOM.knobTlevel.value = STATE.trigger.level;
    
    if (DOM.lblTlevel) {
        DOM.lblTlevel.innerText = STATE.trigger.level.toFixed(2) + 'V';
    }
    if (DOM.osdTriggerLevel) {
        DOM.osdTriggerLevel.innerText = STATE.trigger.level.toFixed(2) + 'V';
    }
};

/**
 * 显示系统模态框 (提示/错误/确认)
 * @param {string} title - 标题
 * @param {string} text - 正文内容
 * @param {Function} [onConfirm] - 点击确认后的回调
 */
export function showSysModal(title, text, onConfirm) {
    DOM.sysModalTitleText.innerText = title; 
    DOM.sysModalText.innerText = text; 
    DOM.sysModal.classList.add('show');
    
    const oldBtn = DOM.sysModalBtn; 
    const newBtn = oldBtn.cloneNode(true); 
    oldBtn.replaceWith(newBtn); 
    DOM.sysModalBtn = newBtn;
    
    DOM.sysModalBtn.onclick = () => { 
        DOM.sysModal.classList.remove('show'); 
        if (onConfirm) {
            setTimeout(onConfirm, 50); 
        }
    };
}