/**
 * ==========================================
 * 核心状态与全局配置模块 (Core System)
 * 负责管理系统全局状态、常量配置、DOM 映射与内存缓冲池
 * ==========================================
 */

/**
 * 全局状态树
 */
export const STATE = {
    power: true, 
    run: true, 
    mode: 'YT',
    ch1: { on: true, pos: 0, scale: 4.0, cpl: 'DC' },
    ch2: { on: true, pos: 0, scale: 4.0, cpl: 'DC' },
    math: { on: false }, 
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
        buffer2: new Float32Array(4096)
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
            // --- 浅色模式 (Light Mode) ---
            bg: [1.0, 1.0, 1.0, 1.0], 
            c1: [0.80, 0.05, 0.10],   
            c2: [0.05, 0.20, 0.85],   
            cM: [0.57, 0.20, 0.91],   
            cXY: [0.05, 0.6, 0.1],    
            
            grid: '#e4e4e7',          
            crosshair: '#a1a1aa',     
            trigger: 'rgba(234, 88, 12, 0.5)', 
            
            cursorY: '#9333ea',       
            cursorX: '#0284c7',       
            hoverBg: 'rgba(255, 255, 255, 0.9)', 
            hoverBorder: '#d4d4d8',   
            hoverText: '#18181b',     
            c1Hex: '#b91c1c',         // HTML UI 匹配深红
            c2Hex: '#1d4ed8',         // HTML UI 匹配深蓝
            
            fftBg: 'rgba(244, 244, 245, 0.85)',
            fftC1: 'rgba(185, 28, 28, 0.95)',
            fftC2: 'rgba(29, 78, 216, 0.95)',
            fftTextDim: 'rgba(0, 0, 0, 0.4)',
            fftTextBright: '#16a34a', 
            
            miniTrace1: 'rgba(185, 28, 28, 0.8)',
            miniTrace2: 'rgba(29, 78, 216, 0.8)'
        } : {
            // --- 深色模式  ---
            bg: [0.0, 0.0, 0.0, 1.0], 
            c1: [0.91, 0.7, 0.04],    
            c2: [0.02, 0.71, 0.83],   
            cM: [0.75, 0.51, 0.98],   
            cXY: [0.1, 1.0, 0.2],     
            
            grid: '#1e2920',
            crosshair: '#2d4a30',
            trigger: 'rgba(255, 165, 0, 0.4)',
            
            cursorY: '#a855f7',
            cursorX: '#38bdf8',
            hoverBg: 'rgba(10, 10, 12, 0.85)',
            hoverBorder: '#444',
            hoverText: '#ffffff',
            c1Hex: '#eab308',
            c2Hex: '#06b6d4',
            
            fftBg: 'rgba(0, 30, 10, 0.6)',
            fftC1: 'rgba(234, 179, 8, 0.8)',
            fftC2: 'rgba(6, 182, 212, 0.8)',
            fftTextDim: 'rgba(255, 255, 255, 0.6)',
            fftTextBright: '#4ade80',
            
            miniTrace1: 'rgba(234,179,8,0.8)',
            miniTrace2: 'rgba(6,182,212,0.8)'
        };
    }
};

export const XY_PTS = 16384;
export const ALPHA_LUT = new Float32Array(XY_PTS);

for (let i = 0; i < XY_PTS; i++) {
    ALPHA_LUT[i] = Math.pow(i / XY_PTS, 30);
}

export const GL_CONST = { 
    BYTES_PER_VERTEX: 20, 
    POS_OFFSET: 0, 
    DATA_OFFSET: 8 
};

export const DOM = {};

document.querySelectorAll('[id]').forEach(el => {
    const camelCaseId = el.id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    DOM[camelCaseId] = el;
});

export const CACHE = { 
    tStateTxt: '', 
    tStateColor: '', 
    mCh1Vpp: '', 
    mCh1Freq: '', 
    mCh2Vpp: '', 
    mCh2Freq: '', 
    audioTimeStr: '', 
    audioSeekVal: -1 
};

export const Buffers = {
    dataL: new Float32Array(CONFIG.fftSize),
    dataR: new Float32Array(CONFIG.fftSize),
    dataMath: new Float32Array(CONFIG.fftSize),
    pData1: new Float32Array(CONFIG.fftSize),
    pData2: new Float32Array(CONFIG.fftSize),
    fftResult: new Float32Array(CONFIG.fftSize / 2)
};

export const updateTriggerUI = () => {
    let src = STATE.trigger.src.toLowerCase();
    let vPerDiv = 1.0 / STATE[src].scale;
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