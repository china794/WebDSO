export const STATE = {
    power: true, run: true, mode: 'YT',
    ch1: { on: true, pos: 0, scale: 4.0, cpl: 'DC' },
    ch2: { on: true, pos: 0, scale: 4.0, cpl: 'DC' },
    math: { on: false }, hpos: 50, secPerDiv: 5,
    trigger: { src: 'CH1', edge: 1, level: 0.0, enabled: false },
    measure: false, awgMonitor: false,
    cursor: { mode: 0, v1: 0.25, v2: -0.25, t1: -0.25, t2: 0.25, dragging: null },
    hover: { active: false, x: 0, y: 0 }, // 从你新版提取的 hover 状态
    serial: {
        connected: false,
        baud: 115200,
        protocol: 'justfloat'
    },
    current: {
        sampleRate: 96000, // 默认为音频采样率
        isSerial: false,
        lineSize: 0.002    // 默认线条粗细
    },
    fft: { 
        on: false, 
        range: 1000, // 默认显示的频率范围 (Hz)
        buffer: new Float32Array(1024) // 频谱绘制缓冲区
    },
};



export const CONFIG = { fftSize: 32768, sampleRate: 96000, gridX: 10, gridY: 8, c1: [0.91, 0.7, 0.04], c2: [0.02, 0.71, 0.83], cM: [0.75, 0.51, 0.98] };
export const XY_PTS = 16384;
export const ALPHA_LUT = new Float32Array(XY_PTS);
for (let i = 0; i < XY_PTS; i++) ALPHA_LUT[i] = Math.pow(i / XY_PTS, 30);
export const GL_CONST = { BYTES_PER_VERTEX: 20, POS_OFFSET: 0, DATA_OFFSET: 8 };

export const DOM = {};
document.querySelectorAll('[id]').forEach(el => {
    const camelCaseId = el.id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    DOM[camelCaseId] = el;
});

export const CACHE = { tStateTxt: '', tStateColor: '', mCh1Vpp: '', mCh1Freq: '', mCh2Vpp: '', mCh2Freq: '', audioTimeStr: '', audioSeekVal: -1 };

// 全局浮点数组，作为对象导出，以保持跨模块的内存引用
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
    DOM.knobTlevel.min = -range; DOM.knobTlevel.max = range; DOM.knobTlevel.step = range / 100;
    STATE.trigger.level = Math.max(-range, Math.min(range, STATE.trigger.level));
    DOM.knobTlevel.value = STATE.trigger.level;
    if (DOM.lblTlevel) DOM.lblTlevel.innerText = STATE.trigger.level.toFixed(2) + 'V';
    if (DOM.osdTriggerLevel) DOM.osdTriggerLevel.innerText = STATE.trigger.level.toFixed(2) + 'V';
};

export function showSysModal(title, text, onConfirm) {
    DOM.sysModalTitleText.innerText = title; DOM.sysModalText.innerText = text; DOM.sysModal.classList.add('show');
    const oldBtn = DOM.sysModalBtn; const newBtn = oldBtn.cloneNode(true); oldBtn.replaceWith(newBtn); DOM.sysModalBtn = newBtn;
    DOM.sysModalBtn.onclick = () => { DOM.sysModal.classList.remove('show'); if (onConfirm) setTimeout(onConfirm, 50); };
}