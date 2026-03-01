/**
 * ==========================================
 * FFT Controller - 频谱分析控制器
 * ==========================================
 * 负责处理 FFT 控制、频谱显示
 */

// TODO: 实现 FFT 控制逻辑
import { STATE, DOM } from '../core.js';
import { RENDER } from '../constants.js';

/**
 * 更新FFT频率范围UI
 * 注意：getMaxFreqForCurrentMode 函数已移至 core.js 避免循环依赖
 */
export function updateFftFreqRange() {
    // 动态导入避免循环依赖
    import('../core.js').then(({ getMaxFreqForCurrentMode }) => {
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
    });
}

export function initFftController() {
    STATE.fft.maxFreq = RENDER.DEFAULT_FFT_MAX_FREQ;
    STATE.fft.gain = RENDER.DEFAULT_FFT_GAIN;
    STATE.fft.logScale = false; 

    if (DOM.btnFftToggle) {
        DOM.btnFftToggle.onclick = () => {
            STATE.fft.on = !STATE.fft.on;
            DOM.btnFftToggle.innerText = STATE.fft.on ? "📊 频谱模式 (ON)" : "📊 频谱模式 (OFF)";
            
            if (STATE.fft.on) DOM.btnFftToggle.classList.add('active');
            else DOM.btnFftToggle.classList.remove('active');
            
            document.getElementById('fft-controls').style.display = STATE.fft.on ? 'flex' : 'none';
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
            if (STATE.fft.logScale) {
                btnFftScale.innerText = "对数 (Log)";
                btnFftScale.classList.add('active');
            } else {
                btnFftScale.innerText = "线性 (Linear)";
                btnFftScale.classList.remove('active');
            }
        });
    }
}