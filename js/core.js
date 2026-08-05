/**
 * ==========================================
 * 核心状态与全局配置模块 (Core System)
 * 负责管理系统全局状态、常量配置、DOM 映射与内存缓冲池
 * ==========================================
 */

import {
    SYSTEM, BUFFER, GRID, TRIGGER, TIMEBASE, GENERATOR, CURSOR, SERIAL, RENDER, COLOR, MIC
} from './constants.js';

/** 通道数量 */
export const CHANNEL_COUNT = SYSTEM.CHANNEL_COUNT;

/** 通道默认配置 (含内置信号发生器参数) */
const createChannelState = () => ({
    on: true, pos: 0, scale: 4.0, cpl: 'DC',
    genType: 'off', genFreq: GENERATOR.DEFAULT_FREQ, genAmp: GENERATOR.DEFAULT_AMP
});

/**
 * 全局状态树 (STATE)
 * 集中管理示波器运行时的所有可调参数与 UI 状怀
 */
/** * ==========================================
 * 状态管理模址(State Management)
 * ==========================================
 * 将原本庞大的上帝对象按功能域拆分，最后组合导净
 */

// 1. 系统核心与时基状怀(Core & Timebase)
const coreState = {
    power: true, 
    run: true, 
    mode: 'YT',
    hpos: 50,
    secPerDiv: TIMEBASE.DEFAULT_MS,
    current: {
        sampleRate: SYSTEM.DEFAULT_SAMPLE_RATE,
        isSerial: false,
        lineSize: RENDER.DEFAULT_LINE_SIZE
    },
    // 真实采样率测量器 - 只数实际收到的有效帧
    realSampleMeasurer: {
        lastTime: performance.now(),
        frameCount: 0,       // 真正收到的有效数据帧敀
        actualRate: 0        // 计算出来的真实频玀(Hz)
    }
};

// 2. 通道状怀(Channels 1-8)
const createChannelsState = () => {
    const channels = {};
    for (let i = 1; i <= 8; i++) {
        // 默认只开吀ch1 咀ch2
        channels[`ch${i}`] = { ...createChannelState(), on: i <= 2 };
    }
    return channels;
};

// 3. I/O 路由与串口状怀(I/O & Serial)
const ioState = {
    awgOutL: 1,
    awgOutR: 2,
    serialOutL: 1,
    serialOutR: 2,
    serial: {
        connected: false,
        baud: SERIAL.DEFAULT_BAUD,
        protocol: 'justfloat'
    }
};

// 4. UI 组件与交互状怀(UI, Cursors & Hover)
const uiState = {
    measure: false,
    awgMonitor: false,
    // 波形余辉 (phosphor persistence)：FBO 帧间累积，老帧缓慢衰减
    phosphor: {
        on: RENDER.PHOSPHOR_DEFAULT_ON,
        decay: RENDER.PHOSPHOR_DECAY,
        gain: RENDER.PHOSPHOR_GAIN,   // 合成亮度增益 (<1 压低亮度防饱和)
    },
    // 渲染层显隐开关
    render: {
        grid: true,      // 网格
        minimap: true,   // 小地图
        overlays: true,  // 触发线/悬停十字线等叠加层
        glow: false,     // 辉光
    },
    trigger: {
        src: 'CH1',
        edge: 1,
        level: 0.0,
        enabled: false,
        frozenIdx: -1,
        holdoff: 0,        // 触发释抑 (采样炀
        hfReject: false,   // 高频抑制
        lfReject: false,   // 低频抑制
        pulseWidth: 0,     // 脉宽触发 (0=兀 >0=脉宽倀
        pulseMode: '>'     // '>' 大于, '<' 小于
    },
    cursor: { 
        mode: CURSOR.DEFAULT_MODE, 
        v1: CURSOR.DEFAULT_V1, 
        v2: CURSOR.DEFAULT_V2, 
        t1: CURSOR.DEFAULT_T1, 
        t2: CURSOR.DEFAULT_T2, 
        dragging: null 
    },
    hover: {
        active: false,
        x: 0,
        y: 0
    },
    math: {
        enabled: false,
        operation: 'add',
        data: null
    },
    refWave: {
        active: false,
        ch: 1,
        data: null,
        scale: 4.0,
        pos: 0
    },
    view3d: {
        yaw: 0.5,
        pitch: 0.3,
        zoom: 1.0,
        perspective: 3.0,
        trailLen: 3,
        cageX: 0.5, cageY: 0.5, cageZ: 0.5
    },
    bytebeat: {
        on: false,
        L: 1,
        R: 2,
    },
    // 声卡输入智能降噪 + 监听
    mic: {
        denoise: MIC.DENOISE_DEFAULT,
        strength: MIC.DENOISE_STRENGTH,
        monitor: false,   // 扬声器监听 (默认关, 防啸叫)
    }
};

// 5. 分析工具状怀(FFT)
const createFFTState = () => {
    const fft = {
        on: false,
        maxFreq: RENDER.DEFAULT_FFT_MAX_FREQ,
        gain: RENDER.DEFAULT_FFT_GAIN,
        logScale: false,               // 线性/对数 X 轴刻度
        showPeaks: RENDER.FFT_DEFAULT_PEAKS,  // 峰值保持线
        smoothing: RENDER.FFT_SMOOTHING,      // 时间平滑系数
    };
    for (let i = 1; i <= 8; i++) {
        // 原始线性幅值谱 (magnitude/N, 0~0.5)
        fft[`buffer${i}`] = new Float32Array(BUFFER.FFT_SMALL);
        // dB 转换后的频谱 (dBFS, 约 -100~-3)
        fft[`dbBuffer${i}`] = new Float32Array(BUFFER.FFT_SMALL);
        // 峰值保持缓存 (dB)，衰减缓慢
        fft[`peakBuffer${i}`] = new Float32Array(BUFFER.FFT_SMALL);
    }
    return fft;
};


// ==========================================
// 最终组裀
// ==========================================
const _rawState = {
    ...coreState,
    ...createChannelsState(),
    ...ioState,
    ...uiState,
    fft: createFFTState()
};

/**
 * 响应开Store 实例
 * 通过 store.watch(path, cb) 订阅状态变曀
 * 通过 store.batch(fn) 批量更新
 *
 * 注意：Store 是一个可选工具，取代旀STATE 直达对象的重枀
 * 是一个渐进过程。目剀STATE 仍是快速普通对象（避免 Proxy
 * 在渲染循环热路径上的性能开销）　
 * 当需要观察某个状态变化时，使甀store.set(path, val) 代替
 * STATE.path = val，然后用 store.watch 订阅　
 */
export const store = new Store(_rawState);

/**
 * 状态对豀 当前使用普通对象（热路径性能优先＀
 * 后续可逐步迁移一store Proxy，但渲染循环中的频繁读取
 * 需要避兀Proxy 开销　
 */
export const STATE = _rawState;

/**
 * 系统常量与动态色彩配罀
 */
// 颜色配置数据 - 浅色模式
const LIGHT_COLORS = {
    bg: [1.0, 1.0, 1.0, 1.0],
    channels: [
        [0.77, 0.12, 0.23], [0.00, 0.34, 0.70], [0.13, 0.55, 0.13], [0.00, 0.55, 0.42],
        [0.44, 0.19, 0.63], [0.00, 0.55, 0.55], [0.82, 0.41, 0.12], [0.69, 0.19, 0.38]
    ],
    hex: ['#C41E3A', '#0056B3', '#228B22', '#008B6B', '#7030A0', '#008B8B', '#D2691E', '#B03060'],
    grid: '#e4e4e7', crosshair: '#a1a1aa', trigger: 'rgba(234, 88, 12, 0.5)',
    cursorY: '#9333ea', cursorX: '#0284c7', hoverBg: 'rgba(255, 255, 255, 0.9)',
    hoverBorder: '#d4d4d8', hoverText: '#18181b',
    cM: [0.57, 0.20, 0.91], cXY: [0.05, 0.6, 0.1],
    fftBg: 'rgba(244, 244, 245, 0.85)', fftTextDim: 'rgba(0, 0, 0, 0.4)', fftTextBright: '#16a34a'
};

// 颜色配置数据 - 深色模式
const DARK_COLORS = {
    bg: [0.0, 0.0, 0.0, 1.0],
    channels: [
        [1.00, 0.23, 0.19], [0.00, 0.48, 1.00], [0.30, 0.85, 0.39], [0.00, 0.83, 0.67],
        [0.69, 0.32, 0.87], [0.35, 0.78, 0.98], [1.00, 0.58, 0.00], [1.00, 0.18, 0.33]
    ],
    hex: ['#FF3B30', '#007AFF', '#4CD964', '#00D4AA', '#AF52DE', '#5AC8FA', '#FF9500', '#FF2D55'],
    grid: '#1e2920', crosshair: '#2d4a30', trigger: 'rgba(255, 165, 0, 0.4)',
    cursorY: '#a855f7', cursorX: '#38bdf8', hoverBg: 'rgba(10, 10, 12, 0.85)',
    hoverBorder: '#444', hoverText: '#ffffff',
    cM: [0.75, 0.51, 0.98], cXY: [0.1, 1.0, 0.2],
    fftBg: 'rgba(0, 30, 10, 0.6)', fftTextDim: 'rgba(255, 255, 255, 0.6)', fftTextBright: '#4ade80'
};

import { hexToRgba } from './utils.js';

/** 生成通道颜色对象 */
function generateChannelColors(cfg) {
    const result = {};
    const isLight = cfg === LIGHT_COLORS;
    
    for (let i = 0; i < 8; i++) {
        const n = i + 1;
        const hexColor = cfg.hex[i];
        
        result['c' + n] = cfg.channels[i];
        result['c' + n + 'Hex'] = hexColor;
        
        // FFT颜色：浅色模式使甀.95透明度，深色模式使用0.8
        const fftAlpha = isLight ? 0.95 : 0.8;
        result['fftC' + n] = hexToRgba(hexColor, fftAlpha);
        
        // 小地图轨迹颜色统一使用0.8透明庀
        result['miniTrace' + n] = hexToRgba(hexColor, 0.8);
    }
    return result;
}

export const CONFIG = {
    fftSize: BUFFER.FFT_SIZE,
    sampleRate: SYSTEM.DEFAULT_SAMPLE_RATE,
    gridX: GRID.DIVISIONS_X,
    gridY: GRID.DIVISIONS_Y,

    get colors() {
        const isLight = document.body.getAttribute('data-theme') === 'light';
        const cfg = isLight ? LIGHT_COLORS : DARK_COLORS;
        const channelColors = generateChannelColors(cfg);

        return {
            bg: cfg.bg,
            ...channelColors,
            cM: cfg.cM, cXY: cfg.cXY,
            grid: cfg.grid, crosshair: cfg.crosshair, trigger: cfg.trigger,
            cursorY: cfg.cursorY, cursorX: cfg.cursorX,
            hoverBg: cfg.hoverBg, hoverBorder: cfg.hoverBorder, hoverText: cfg.hoverText,
            fftBg: cfg.fftBg, fftTextDim: cfg.fftTextDim, fftTextBright: cfg.fftTextBright
        };
    }
};

/**
 * 根据当前采样率计算FFT最大频率（奈奎斯特频率的一半，留有余量＀
 * @returns {number} 最大频玀Hz)
 */
export function getMaxFreqForCurrentMode() {
    const currentRate = STATE.current.sampleRate || CONFIG.sampleRate;
    // 奈奎斯特频率是采样率的一半，但留一些余釀
    // 使用采样率的0.6倍（毀.5夀0%），确保能显示到奈奎斯特频率附近
    return Math.floor(currentRate * 0.6);
}

/** X-Y 模式下李萨如图形的采样点敀*/
export const XY_PTS = BUFFER.XY_POINTS;
/** X-Y 模式下用于渐变透明度的查找血(越新越亮) */
export const ALPHA_LUT = new Float32Array(XY_PTS);

for (let i = 0; i < XY_PTS; i++) {
    ALPHA_LUT[i] = Math.pow(i / XY_PTS, COLOR.ALPHA_LUT_EXP);
}

/** WebGL 顶点缓冲布局常量 (每顶炀20 字节: 2*float pos + 3*float data) */
export const GL_CONST = {
    BYTES_PER_VERTEX: 20,
    POS_OFFSET: 0,
    DATA_OFFSET: 8
};

/** 全局 DOM 引用表：尀id 转为驼峰命名并缓孀*/
export const DOM = {};

/** 全局事件管理噀- 避免内存泄漏 */
import { EventManager } from './utils.js';
import { Store, createStateProxy } from './store.js';
export const eventManager = new EventManager();

/**
 * 初始化DOM引用 - 应在DOM加载完成后调甀
 * 这个函数会被main.js调用，确保DOM已准备好
 */
export function initDOM() {
    document.querySelectorAll('[id]').forEach(el => {
        const camelCaseId = el.id.replace(/-([a-z0-9])/g, (g) => g[1].toUpperCase());
        DOM[camelCaseId] = el;
    });
}

/** 渲染缓存：避免重复写 DOM 造成闪烁 */
export const CACHE = {
    tStateTxt: '', tStateColor: '',
    // CH1-CH8 测量值缓孀(Vpp, Freq, Vmax, Vmin, Vavg, Duty, RMS, Period)
    mCh1Vpp: '', mCh1Freq: '', mCh1Vmax: '', mCh1Vmin: '', mCh1Vavg: '', mCh1Duty: '', mCh1Rms: '', mCh1Period: '',
    mCh2Vpp: '', mCh2Freq: '', mCh2Vmax: '', mCh2Vmin: '', mCh2Vavg: '', mCh2Duty: '', mCh2Rms: '', mCh2Period: '',
    mCh3Vpp: '', mCh3Freq: '', mCh3Vmax: '', mCh3Vmin: '', mCh3Vavg: '', mCh3Duty: '', mCh3Rms: '', mCh3Period: '',
    mCh4Vpp: '', mCh4Freq: '', mCh4Vmax: '', mCh4Vmin: '', mCh4Vavg: '', mCh4Duty: '', mCh4Rms: '', mCh4Period: '',
    mCh5Vpp: '', mCh5Freq: '', mCh5Vmax: '', mCh5Vmin: '', mCh5Vavg: '', mCh5Duty: '', mCh5Rms: '', mCh5Period: '',
    mCh6Vpp: '', mCh6Freq: '', mCh6Vmax: '', mCh6Vmin: '', mCh6Vavg: '', mCh6Duty: '', mCh6Rms: '', mCh6Period: '',
    mCh7Vpp: '', mCh7Freq: '', mCh7Vmax: '', mCh7Vmin: '', mCh7Vavg: '', mCh7Duty: '', mCh7Rms: '', mCh7Period: '',
    mCh8Vpp: '', mCh8Freq: '', mCh8Vmax: '', mCh8Vmin: '', mCh8Vavg: '', mCh8Duty: '', mCh8Rms: '', mCh8Period: '',
    audioTimeStr: '', audioSeekVal: -1
};

/** 共享数据缓冲池：原始数据、处理后数据、FFT 结果 */
// 使用串口模式的大缓冲区大小，确保可以显示更多波形数据
const DATA_BUFFER_SIZE = Math.max(BUFFER.FFT_SIZE, BUFFER.SERIAL_FFT_SIZE);
export const Buffers = {
    data1: new Float32Array(DATA_BUFFER_SIZE), data2: new Float32Array(DATA_BUFFER_SIZE),
    data3: new Float32Array(DATA_BUFFER_SIZE), data4: new Float32Array(DATA_BUFFER_SIZE),
    data5: new Float32Array(DATA_BUFFER_SIZE), data6: new Float32Array(DATA_BUFFER_SIZE),
    data7: new Float32Array(DATA_BUFFER_SIZE), data8: new Float32Array(DATA_BUFFER_SIZE),
    pData1: new Float32Array(DATA_BUFFER_SIZE), pData2: new Float32Array(DATA_BUFFER_SIZE),
    pData3: new Float32Array(DATA_BUFFER_SIZE), pData4: new Float32Array(DATA_BUFFER_SIZE),
    pData5: new Float32Array(DATA_BUFFER_SIZE), pData6: new Float32Array(DATA_BUFFER_SIZE),
    pData7: new Float32Array(DATA_BUFFER_SIZE), pData8: new Float32Array(DATA_BUFFER_SIZE),
    fftResult: new Float32Array(BUFFER.FFT_SIZE / 2)  // FFT结果保持标准大小
};

/**
 * 根据当前通道档位更新触发电平滑块的量稀
 * 确保触发电平始终在有效范围内
 */
export const updateTriggerUI = () => {
    const src = STATE.trigger.src.toLowerCase();
    const ch = STATE[src];
    if (!ch) return;
    let vPerDiv = 1.0 / ch.scale;
    let range = TRIGGER.RANGE_MULTIPLIER * vPerDiv;

    if (DOM.knobTlevel) {
        DOM.knobTlevel.min = -range;
        DOM.knobTlevel.max = range;
        DOM.knobTlevel.step = range / TRIGGER.STEP_DIVISOR;

        STATE.trigger.level = Math.max(-range, Math.min(range, STATE.trigger.level));
        DOM.knobTlevel.value = STATE.trigger.level;
    }

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
    if (!DOM.sysModal || !DOM.sysModalTitleText || !DOM.sysModalText || !DOM.sysModalBtn) {
        console.error('Modal DOM elements not found');
        return;
    }
    
    DOM.sysModalTitleText.innerText = title; 
    DOM.sysModalText.innerText = text; 
    DOM.sysModal.classList.add('show');
    
    // 清理旧的事件监听器（通过替换按钮实现＀
    const oldBtn = DOM.sysModalBtn; 
    const newBtn = oldBtn.cloneNode(true); 
    
    // 移除旧按钮的所有事件监听器
    const oldBtnClone = oldBtn.cloneNode(false);
    oldBtnClone.innerHTML = oldBtn.innerHTML;
    
    oldBtn.replaceWith(newBtn); 
    DOM.sysModalBtn = newBtn;
    
    // 添加新的事件监听噀
    const clickHandler = () => {
        DOM.sysModal.classList.remove('show');
        // 移除事件监听器防止内存泄漀
        DOM.sysModalBtn.removeEventListener('click', clickHandler);
        if (onConfirm) {
            setTimeout(onConfirm, 50);
        }
    };
    
    DOM.sysModalBtn.addEventListener('click', clickHandler);
    
    // 点击遮罩层关闭模态框
    const backdropClickHandler = (e) => {
        if (e.target === DOM.sysModal) {
            DOM.sysModal.classList.remove('show');
            DOM.sysModal.removeEventListener('click', backdropClickHandler);
        }
    };
    
    // 移除旧的遮罩层监听器并添加新皀
    DOM.sysModal.removeEventListener('click', backdropClickHandler);
    DOM.sysModal.addEventListener('click', backdropClickHandler);
}