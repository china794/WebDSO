/**
 * ==========================================
 * FFT Controller - 频谱分析控制器
 * ==========================================
 * 负责处理 FFT 控制、频谱显示
 */

import { STATE, DOM, getMaxFreqForCurrentMode } from '../core.js';
import { RENDER } from '../constants.js';

/**
 * 更新 FFT 频率范围 UI
 * 串口模式下复用同一逻辑（serial.js 调用此函数，替代其重复实现）
 */
export function updateFftFreqRange() {
    const maxFreq = getMaxFreqForCurrentMode();
    const fftMaxKnob = document.getElementById('knob-fft-max');
    const fftMaxLbl = document.getElementById('lbl-fft-max');

    if (fftMaxKnob) {
        // 更新旋钮的最大值
        fftMaxKnob.max = maxFreq;
        // 如果当前值超过新的最大值，调整为新的最大值
        if (STATE.fft.maxFreq > maxFreq) {
            STATE.fft.maxFreq = maxFreq;
            fftMaxKnob.value = maxFreq;
        }
    }

    if (fftMaxLbl) {
        fftMaxLbl.innerText = STATE.fft.maxFreq + 'Hz';
    }
}

/** 同步 FFT UI 控件文本/状态（开关、刻度、峰值、平滑、量程） */
export function syncFftUI() {
    if (DOM.btnFftToggle) {
        DOM.btnFftToggle.innerText = STATE.fft.on ? "📊 频谱模式 (ON)" : "📊 频谱模式 (OFF)";
        DOM.btnFftToggle.classList.toggle('active', STATE.fft.on);
        const controls = document.getElementById('fft-controls');
        if (controls) controls.style.display = STATE.fft.on ? 'flex' : 'none';
    }
    if (DOM.btnFftScale) {
        DOM.btnFftScale.innerText = STATE.fft.logScale ? "对数 (Log)" : "线性 (Linear)";
        DOM.btnFftScale.classList.toggle('active', STATE.fft.logScale);
    }
    if (DOM.btnFftPeaks) {
        DOM.btnFftPeaks.innerText = STATE.fft.showPeaks ? "峰值保持: 开" : "峰值保持: 关";
        DOM.btnFftPeaks.classList.toggle('active', STATE.fft.showPeaks);
    }
    if (DOM.knobFftSmooth && DOM.lblFftSmooth) {
        const v = Math.round(STATE.fft.smoothing * 100);
        DOM.knobFftSmooth.value = v;
        DOM.lblFftSmooth.innerText = 'x' + v;
    }
}

export function initFftController() {
    // logScale/showPeaks/smoothing 已在 core.js createFFTState 初始化。
    // 此处只保证与默认常量一致（配置导入可能覆盖）。
    if (typeof STATE.fft.logScale !== 'boolean') STATE.fft.logScale = false;
    if (typeof STATE.fft.showPeaks !== 'boolean') STATE.fft.showPeaks = RENDER.FFT_DEFAULT_PEAKS;
    if (typeof STATE.fft.smoothing !== 'number') STATE.fft.smoothing = RENDER.FFT_SMOOTHING;
    STATE.fft.maxFreq = STATE.fft.maxFreq || RENDER.DEFAULT_FFT_MAX_FREQ;
    STATE.fft.gain = STATE.fft.gain || RENDER.DEFAULT_FFT_GAIN;

    if (DOM.btnFftToggle) {
        DOM.btnFftToggle.onclick = () => {
            STATE.fft.on = !STATE.fft.on;
            syncFftUI();
        };
    }

    const fftMaxKnob = document.getElementById('knob-fft-max');
    const fftMaxLbl = document.getElementById('lbl-fft-max');
    if (fftMaxKnob) {
        fftMaxKnob.addEventListener('input', (e) => {
            STATE.fft.maxFreq = parseInt(e.target.value);
            fftMaxLbl.innerText = STATE.fft.maxFreq + 'Hz';
        });
    }

    const fftGainKnob = document.getElementById('knob-fft-gain');
    const fftGainLbl = document.getElementById('lbl-fft-gain');
    if (fftGainKnob) {
        fftGainKnob.addEventListener('input', (e) => {
            STATE.fft.gain = parseInt(e.target.value);
            fftGainLbl.innerText = 'x' + STATE.fft.gain;
        });
    }

    const btnFftScale = document.getElementById('btn-fft-scale');
    if (btnFftScale) {
        btnFftScale.addEventListener('click', () => {
            STATE.fft.logScale = !STATE.fft.logScale;
            syncFftUI();
        });
    }

    // 峰值保持开关
    const btnFftPeaks = document.getElementById('btn-fft-peaks');
    if (btnFftPeaks) {
        btnFftPeaks.addEventListener('click', () => {
            STATE.fft.showPeaks = !STATE.fft.showPeaks;
            syncFftUI();
        });
    }

    // 平滑度滑块
    const knobFftSmooth = document.getElementById('knob-fft-smooth');
    const lblFftSmooth = document.getElementById('lbl-fft-smooth');
    if (knobFftSmooth) {
        knobFftSmooth.addEventListener('input', (e) => {
            STATE.fft.smoothing = parseInt(e.target.value) / 100;
            lblFftSmooth.innerText = 'x' + e.target.value;
        });
    }

    syncFftUI();
}
