import { STATE, CONFIG, DOM, updateTriggerUI, showSysModal, Buffers } from './core.js';
import { AudioState, initAudio, rebuildChannel, updateAWG, playBuffer, getLogSpeed, getCurrentTime } from './audio.js';
import { resize, draw } from './render.js';
import { SerialEngine } from './serial.js';

/**
 * ==========================================
 * 主题切换机制 (深/浅色模式 - SVG 版)
 * ==========================================
 */
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeIconPath = document.getElementById('theme-icon-path');

// 定义路径常量
const sunPath = "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z";
const moonPath = "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z";

if (btnThemeToggle && themeIconPath) {
    const currentTheme = localStorage.getItem('theme') || 'dark';
    if (currentTheme === 'light') {
        document.body.setAttribute('data-theme', 'light');
        themeIconPath.setAttribute('d', moonPath); 
    }
    
    btnThemeToggle.addEventListener('click', () => {
        const isLight = document.body.getAttribute('data-theme') === 'light';
        if (isLight) {
            document.body.removeAttribute('data-theme');
            localStorage.setItem('theme', 'dark');
            themeIconPath.setAttribute('d', sunPath);
        } else {
            document.body.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
            themeIconPath.setAttribute('d', moonPath); 
        }
    });
}

/**
 * ==========================================
 * 全局工具监听与绑定函数
 * ==========================================
 */
const bindToggle = (domEl, prop, cb) => {
    domEl.addEventListener('click', () => {
        prop.on = !prop.on;
        domEl.classList.toggle('active', prop.on);
        if (cb) cb();
    });
};

const bindKnob = (domInput, domLbl, domOsd, fmt, act) => {
    domInput.addEventListener('input', (e) => {
        let v = parseFloat(e.target.value);
        if (domLbl) domLbl.innerText = fmt(v);
        if (domOsd) domOsd.innerText = fmt(v);
        act(v);
    });
};

// ==========================================
// 视口与基础系统控制
// ==========================================

window.addEventListener('resize', resize);
resize();

// 运行/停止按钮
DOM.btnRunstop.addEventListener('click', function () {
    STATE.run = !STATE.run;
    if (STATE.run) {
        this.classList.remove('stopped');
        DOM.osdRunState.innerText = "run";
    } else {
        this.classList.add('stopped');
        DOM.osdRunState.innerText = "stop";
    }
});

// ==========================================
// 顶部工具栏控制
// ==========================================

bindToggle(DOM.btnCh1, STATE.ch1);
bindToggle(DOM.btnCh2, STATE.ch2);
bindToggle(DOM.btnMath, STATE.math, () => {
    DOM.osdMathBox.style.display = STATE.math.on ? 'flex' : 'none';
});

// YT / XY 模式切换
DOM.btnXy.addEventListener('click', function () {
    STATE.mode = 'XY';
    this.classList.add('active');
    DOM.btnDisplay.classList.remove('active');
});

DOM.btnDisplay.addEventListener('click', function () {
    STATE.mode = 'YT';
    this.classList.add('active');
    DOM.btnXy.classList.remove('active');
});

// 测量面板开关
DOM.btnMeasure.addEventListener('click', function () {
    STATE.measure = !STATE.measure;
    this.classList.toggle('active');
    DOM.measurePanel.style.display = STATE.measure ? 'flex' : 'none';
});

// 手动光标模式切换 (已全部改为 classList 切换)
DOM.btnCursors.addEventListener('click', function () {
    STATE.cursor.mode = (STATE.cursor.mode + 1) % 3;
    this.innerText = ['光标: 关', '光标: Y轴(电压)', '光标: X轴(时间)'][STATE.cursor.mode];
    
    if (STATE.cursor.mode === 0) {
        this.classList.remove('active');
    } else {
        this.classList.add('active');
    }
});

// ==========================================
// 垂直、水平与触发控制旋钮
// ==========================================

// 触发器开关 (已全部改为 classList 切换)
DOM.btnTrigEn.addEventListener('click', function () {
    STATE.trigger.enabled = !STATE.trigger.enabled;
    if (STATE.trigger.enabled) {
        this.innerText = '触发: 开';
        this.classList.add('active');
    } else {
        this.innerText = '触发: 关';
        this.classList.remove('active');
        window._frozenTriggerIdx = -1;
    }
});

// CH1 垂直档位与偏移
bindKnob(DOM.knobPos1, DOM.lblPos1, null, v => v.toFixed(2), v => STATE.ch1.pos = v);
DOM.numScale1.addEventListener('change', (e) => {
    let v = parseFloat(e.target.value);
    if (isNaN(v) || v <= 0) v = 0.25;
    e.target.value = v.toFixed(2);
    STATE.ch1.scale = 1 / v;
    DOM.osdCh1Scale.innerText = v.toFixed(2) + 'V';
    updateTriggerUI();
});
DOM.cplCh1.addEventListener('change', e => {
    STATE.ch1.cpl = e.target.value;
    DOM.osdCpl1.innerText = e.target.value;
});

// CH2 垂直档位与偏移
bindKnob(DOM.knobPos2, DOM.lblPos2, null, v => v.toFixed(2), v => STATE.ch2.pos = v);
DOM.numScale2.addEventListener('change', (e) => {
    let v = parseFloat(e.target.value);
    if (isNaN(v) || v <= 0) v = 0.25;
    e.target.value = v.toFixed(2);
    STATE.ch2.scale = 1 / v;
    DOM.osdCh2Scale.innerText = v.toFixed(2) + 'V';
    updateTriggerUI();
});
DOM.cplCh2.addEventListener('change', e => {
    STATE.ch2.cpl = e.target.value;
    DOM.osdCpl2.innerText = e.target.value;
});

// 水平中心偏移 (H-POS)
bindKnob(DOM.knobHpos, DOM.lblHpos, null, v => v.toFixed(1) + '%', v => STATE.hpos = v);

// 水平时基控制 (Timebase)
DOM.knobTimebase.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    STATE.secPerDiv = val;
    
    const displayVal = val.toFixed(1) + "ms";
    DOM.lblTimebase.innerText = displayVal;
    if (DOM.osdTimebase) DOM.osdTimebase.innerText = displayVal;
});

// 触发源、边沿与电平
DOM.trigSrc.addEventListener('change', e => {
    STATE.trigger.src = e.target.value;
    if (DOM.osdTriggerSrc) DOM.osdTriggerSrc.innerText = e.target.value;
    updateTriggerUI();
});

DOM.btnEdge.addEventListener('click', function () {
    STATE.trigger.edge *= -1;
    this.innerText = '边沿: ' + (STATE.trigger.edge === 1 ? '↗ 上升沿' : '↘ 下降沿');
    if (DOM.osdTriggerEdge) {
        DOM.osdTriggerEdge.innerText = STATE.trigger.edge === 1 ? '↗' : '↘';
    }
});

DOM.knobTlevel.addEventListener('input', (e) => {
    let v = parseFloat(e.target.value);
    STATE.trigger.level = v;
    if (DOM.lblTlevel) DOM.lblTlevel.innerText = v.toFixed(2) + 'V';
    if (DOM.osdTriggerLevel) DOM.osdTriggerLevel.innerText = v.toFixed(2) + 'V';
});

/**
 * ==========================================
 * 全局并集视角的 Auto-Set 核心算法
 * ==========================================
 */
DOM.btnAutoset.addEventListener('click', () => {
    if (!STATE.run) {
        showSysModal('提示', '请先运行示波器 (RUN) 以采集数据');
        return;
    }
    
    const scanLen = Math.min(8000, Buffers.dataL.length);
    const currentRate = (STATE.current && STATE.current.sampleRate) ? STATE.current.sampleRate : CONFIG.sampleRate;

    const analyzeChannel = (rawData) => {
        let max = -999, min = 999, sum = 0, crossings = 0;
        
        for (let i = 0; i < scanLen; i++) {
            let val = rawData[i];
            if (val > max) max = val;
            if (val < min) min = val;
            sum += val;
        }
        
        const dcOffset = sum / scanLen;
        const vpp = max - min;
        
        let prevVal = rawData[0] - dcOffset;
        for (let i = 1; i < scanLen; i++) {
            let val = rawData[i] - dcOffset;
            if (prevVal < 0 && val >= 0) crossings++;
            prevVal = val;
        }
        
        let freq = crossings > 1 ? (crossings * (currentRate / scanLen)) : 0;
        return { dcOffset, vpp, freq, valid: vpp > 0.02 }; 
    };

    const stat1 = analyzeChannel(Buffers.dataL);
    const stat2 = analyzeChannel(Buffers.dataR);

    if (!stat1.valid && !stat2.valid) {
        showSysModal('Auto-Set 失败', '双通道信号均太微弱或无信号，无法自动捕捉');
        return;
    }

    let vPerDiv1 = (stat1.valid && STATE.ch1.on) ? stat1.vpp / 4.0 : 0.01;
    let vPerDiv2 = (stat2.valid && STATE.ch2.on) ? stat2.vpp / 4.0 : 0.01;
    
    let targetVPerDiv = Math.max(vPerDiv1, vPerDiv2);
    let unifiedScale = Math.max(0.01, Math.min(1000, 1.0 / targetVPerDiv));

    if (stat1.valid && STATE.ch1.on) {
        STATE.ch1.scale = unifiedScale;
        STATE.ch1.pos = -stat1.dcOffset * unifiedScale * (2.0 / CONFIG.gridY); 
        
        DOM.knobPos1.value = STATE.ch1.pos; 
        DOM.lblPos1.innerText = STATE.ch1.pos.toFixed(2);
        DOM.numScale1.value = targetVPerDiv.toFixed(2); 
        DOM.osdCh1Scale.innerText = targetVPerDiv.toFixed(2) + 'V';
    }

    if (stat2.valid && STATE.ch2.on) {
        STATE.ch2.scale = unifiedScale;
        STATE.ch2.pos = -stat2.dcOffset * unifiedScale * (2.0 / CONFIG.gridY); 
        
        DOM.knobPos2.value = STATE.ch2.pos; 
        DOM.lblPos2.innerText = STATE.ch2.pos.toFixed(2);
        DOM.numScale2.value = targetVPerDiv.toFixed(2); 
        DOM.osdCh2Scale.innerText = targetVPerDiv.toFixed(2) + 'V';
    }

    let masterFreq = 0;
    let trigSrc = 'CH1';
    let trigOffset = 0;

    if (stat1.valid && stat2.valid && STATE.ch1.on && STATE.ch2.on) {
        if (stat1.vpp >= stat2.vpp) { 
            masterFreq = stat1.freq; 
            trigSrc = 'CH1'; 
            trigOffset = stat1.dcOffset; 
        } else { 
            masterFreq = stat2.freq; 
            trigSrc = 'CH2'; 
            trigOffset = stat2.dcOffset; 
        }
    } else if (stat1.valid && STATE.ch1.on) { 
        masterFreq = stat1.freq; 
        trigSrc = 'CH1'; 
        trigOffset = stat1.dcOffset; 
    } else if (stat2.valid && STATE.ch2.on) { 
        masterFreq = stat2.freq; 
        trigSrc = 'CH2'; 
        trigOffset = stat2.dcOffset; 
    }

    if (masterFreq > 0) {
        let targetSecPerDiv = ((1000.0 / masterFreq) * 4) / CONFIG.gridX; 
        targetSecPerDiv = Math.max(0.1, Math.min(1000, targetSecPerDiv));
        STATE.secPerDiv = targetSecPerDiv;
        
        DOM.knobTimebase.value = targetSecPerDiv;
        DOM.lblTimebase.innerText = targetSecPerDiv.toFixed(2) + 'ms';
        if (DOM.osdTimebase) DOM.osdTimebase.innerText = targetSecPerDiv.toFixed(2) + 'ms';
    }

    STATE.trigger.enabled = true;
    STATE.trigger.src = trigSrc;
    STATE.trigger.level = trigOffset; 
    
    DOM.btnTrigEn.innerText = '触发: 开'; 
    DOM.btnTrigEn.classList.add('active');
    
    DOM.trigSrc.value = trigSrc; 
    if (DOM.osdTriggerSrc) DOM.osdTriggerSrc.innerText = trigSrc;
    
    DOM.knobTlevel.value = trigOffset; 
    if (DOM.lblTlevel) DOM.lblTlevel.innerText = trigOffset.toFixed(2) + 'V';
    
    updateTriggerUI();
    DOM.knobTimebase.dispatchEvent(new Event('input'));
});

// ==========================================
// 音频硬件设备与麦克风输入 (已全部改为 classList 切换)
// ==========================================

DOM.btnMic.addEventListener('click', async function () {
    initAudio(); 
    if (AudioState.audioCtx.state === 'suspended') {
        await AudioState.audioCtx.resume();
    }
    
    if (AudioState.micSource) { 
        AudioState.micSource.disconnect(); 
        if (AudioState.micStream) {
            AudioState.micStream.getTracks().forEach(t => t.stop()); 
        }
        AudioState.micSource = null; 
        AudioState.micStream = null; 
        this.classList.remove('active');
        this.innerText = '声卡输入'; 
        return; 
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { 
        return showSysModal('环境不支持', '当前浏览器禁止在非 HTTPS 下获取物理音频。'); 
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                channelCount: { ideal: 2 }, 
                echoCancellation: false, 
                noiseSuppression: false, 
                autoGainControl: false, 
                latency: 0 
            } 
        });
        AudioState.micStream = stream; 
        AudioState.micSource = AudioState.audioCtx.createMediaStreamSource(stream); 
        AudioState.micSource.channelCount = 2; 
        AudioState.micSource.channelCountMode = 'explicit'; 
        AudioState.micSource.connect(AudioState.splitter); 
        this.classList.add('active');
        this.innerText = '已连接';
    } catch (e) { 
        showSysModal('设备连接失败', e.message); 
    }
});

// ==========================================
// 交互与拖拽事件控制 (Canvas 层)
// ==========================================

const getNDC = (e) => {
    const rect = DOM.glCanvas.getBoundingClientRect(); 
    let cX = e.clientX;
    let cY = e.clientY;
    
    if (e.touches && e.touches.length > 0) { 
        cX = e.touches[0].clientX; 
        cY = e.touches[0].clientY; 
    }
    
    return { 
        x: (cX - rect.left) / rect.width * 2.0 - 1.0, 
        y: -((cY - rect.top) / rect.height * 2.0 - 1.0) 
    };
};

const startCursorDrag = (e) => {
    if (STATE.cursor.mode === 0) return;
    
    const { x, y } = getNDC(e); 
    const thr = 0.15;
    
    if (STATE.cursor.mode === 1) { 
        if (Math.abs(y - STATE.cursor.v1) < thr) STATE.cursor.dragging = 'v1'; 
        else if (Math.abs(y - STATE.cursor.v2) < thr) STATE.cursor.dragging = 'v2'; 
    } else if (STATE.cursor.mode === 2) { 
        if (Math.abs(x - STATE.cursor.t1) < thr) STATE.cursor.dragging = 't1'; 
        else if (Math.abs(x - STATE.cursor.t2) < thr) STATE.cursor.dragging = 't2'; 
    }
};

const doCursorDrag = (e) => {
    if (!STATE.cursor.dragging) return; 
    e.preventDefault(); 
    const { x, y } = getNDC(e);
    
    if (STATE.cursor.dragging.startsWith('v')) { 
        STATE.cursor[STATE.cursor.dragging] = Math.max(-1, Math.min(1, y)); 
    } else { 
        STATE.cursor[STATE.cursor.dragging] = Math.max(-1, Math.min(1, x)); 
    }
};

const endCursorDrag = () => { 
    STATE.cursor.dragging = null; 
};

DOM.glCanvas.addEventListener('mousemove', (e) => {
    const rect = DOM.glCanvas.getBoundingClientRect();
    if (STATE.cursor.dragging) { 
        STATE.hover.active = false; 
        return; 
    }
    STATE.hover.x = e.clientX - rect.left; 
    STATE.hover.y = e.clientY - rect.top; 
    STATE.hover.active = true;
});

DOM.glCanvas.addEventListener('mouseleave', () => { 
    STATE.hover.active = false; 
});
DOM.glCanvas.addEventListener('mousedown', startCursorDrag); 
window.addEventListener('mousemove', doCursorDrag, { passive: false }); 
window.addEventListener('mouseup', endCursorDrag);

DOM.glCanvas.addEventListener('touchstart', startCursorDrag, { passive: true }); 
window.addEventListener('touchmove', doCursorDrag, { passive: false }); 
window.addEventListener('touchend', endCursorDrag);

// ==========================================
// 内置信号发生器 (AWG) 控制
// ==========================================

const bindFreqControl = (ch) => {
    const slider = DOM[`knobGenFreq${ch}`];
    const numBox = DOM[`numGenFreq${ch}`];
    
    slider.addEventListener('input', (e) => { 
        let freq = Math.round(Math.pow(10, e.target.value / 100)); 
        numBox.value = freq; 
        updateAWG(ch, freq); 
    });
    
    numBox.addEventListener('change', (e) => { 
        let freq = parseFloat(e.target.value); 
        if (isNaN(freq) || freq < 1) freq = 1; 
        
        let maxFreq = CONFIG.sampleRate / 2; 
        if (freq > maxFreq) freq = maxFreq; 
        
        numBox.value = freq; 
        slider.value = Math.log10(freq) * 100; 
        updateAWG(ch, freq); 
    });
    
    DOM[`genType${ch}`].addEventListener('change', () => { 
        updateAWG(ch, parseFloat(numBox.value)); 
    });
};

const bindAmpControl = (ch) => {
    const slider = DOM[`knobGenAmp${ch}`];
    const numBox = DOM[`numGenAmp${ch}`];
    
    slider.addEventListener('input', (e) => { 
        let amp = parseFloat(e.target.value); 
        numBox.value = amp.toFixed(2); 
        
        if (ch === 1 && AudioState.awgGain1) {
            AudioState.awgGain1.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime); 
        }
        if (ch === 2 && AudioState.awgGain2) {
            AudioState.awgGain2.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime); 
        }
    });
    
    numBox.addEventListener('change', (e) => { 
        let amp = parseFloat(e.target.value); 
        if (isNaN(amp) || amp < 0) amp = 0; 
        if (amp > 20) amp = 20; 
        
        numBox.value = amp.toFixed(2); 
        slider.value = amp; 
        
        if (ch === 1 && AudioState.awgGain1) {
            AudioState.awgGain1.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime); 
        }
        if (ch === 2 && AudioState.awgGain2) {
            AudioState.awgGain2.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime); 
        }
    });
};

bindFreqControl(1); 
bindFreqControl(2);
bindAmpControl(1); 
bindAmpControl(2);

// AWG 监听扬声器 (已全部改为 classList 切换)
DOM.btnAwgSpk.addEventListener('click', function () {
    initAudio(); 
    STATE.awgMonitor = !STATE.awgMonitor;
    if (STATE.awgMonitor) { 
        this.innerText = '🔊 扬声器: 开'; 
        this.classList.add('active');
        AudioState.awgSpeakerGain.gain.value = 1.0; 
    } else { 
        this.innerText = '🔈 扬声器: 关'; 
        this.classList.remove('active');
        AudioState.awgSpeakerGain.gain.value = 0; 
    }
});

// ==========================================
// 音频文件解析与播放控制
// ==========================================

const unlockAudio = () => { 
    initAudio(); 
    rebuildChannel(1); 
    rebuildChannel(2); 
    if (AudioState.audioCtx && AudioState.audioCtx.state === 'suspended') {
        AudioState.audioCtx.resume(); 
    }
    document.removeEventListener('click', unlockAudio); 
}; 
document.addEventListener('click', unlockAudio);

if (DOM.btnCancelDownload) { 
    DOM.btnCancelDownload.addEventListener('click', () => { 
        if (AudioState.currentXHR) { 
            AudioState.currentXHR.abort(); 
        } 
        document.getElementById('audio-loading-overlay').style.display = 'none'; 
        DOM.btnAudioToggle.disabled = false; 
    }); 
}

DOM.audioSeekBar.addEventListener('input', () => { 
    AudioState.isSeeking = true; 
});

DOM.audioSeekBar.addEventListener('change', (e) => { 
    if (!AudioState.audioBuffer) return; 
    playBuffer(null, (parseFloat(e.target.value) / 100) * AudioState.audioBuffer.duration); 
    AudioState.isSeeking = false; 
});

DOM.knobAudioSpeed.addEventListener('input', function (e) { 
    let speed = getLogSpeed(parseFloat(e.target.value)); 
    DOM.lblAudioSpeed.innerText = (speed < 0.01 ? speed.toFixed(3) : speed.toFixed(2)) + 'x'; 
    
    if (AudioState.bufferSource && AudioState.isMusicPlaying) { 
        AudioState.startOffset = getCurrentTime(); 
        AudioState.startTime = AudioState.audioCtx.currentTime; 
        AudioState.bufferSource.playbackRate.value = speed; 
    } 
});

DOM.fileSelect.addEventListener('change', function (e) { 
    const val = e.target.value; 
    if (!val) return; 
    if (val === 'LOCAL') { 
        DOM.fileInput.click(); 
    } else { 
        playBuffer(val); 
    } 
    e.target.selectedIndex = 0; 
});

DOM.fileInput.addEventListener('change', function () { 
    if (this.files[0]) playBuffer(this.files[0]); 
});

DOM.btnAudioToggle.addEventListener('click', function () {
    if (!AudioState.audioBuffer) return;
    if (AudioState.isMusicPlaying) { 
        let cur = getCurrentTime(); 
        if (AudioState.bufferSource) { 
            try { 
                AudioState.bufferSource.stop(); 
            } catch (e) { } 
            AudioState.bufferSource.disconnect(); 
            AudioState.bufferSource = null; 
        } 
        AudioState.startOffset = cur; 
        AudioState.isMusicPlaying = false; 
        this.innerText = ' ▶ '; 
    } else { 
        playBuffer(null, AudioState.startOffset); 
    }
});

DOM.knobAudioSpeed.dispatchEvent(new Event('input')); 
DOM.cplCh1.dispatchEvent(new Event('change')); 
DOM.cplCh2.dispatchEvent(new Event('change')); 
updateTriggerUI();

[1, 2].forEach(ch => {
    const input = DOM['numScale' + ch]; 
    const btnUp = document.getElementById('btn-s' + ch + '-up'); 
    const btnDn = document.getElementById('btn-s' + ch + '-dn');
    
    if (btnUp && btnDn && input) {
        btnUp.addEventListener('click', () => { 
            let v = parseFloat(input.value) || 0; 
            input.value = (v + 0.05).toFixed(2); 
            input.dispatchEvent(new Event('change')); 
        });
        
        btnDn.addEventListener('click', () => { 
            let v = parseFloat(input.value) || 0; 
            if (v > 0.05) { 
                input.value = (v - 0.05).toFixed(2); 
                input.dispatchEvent(new Event('change')); 
            } 
        });
    }
});

DOM.osdSamplerate.innerText = (CONFIG.sampleRate / 1000).toFixed(1) + 'kSa/s (Audio)';

// ==========================================
// 串口通信操作控制
// ==========================================

DOM.btnSerialOpen.addEventListener('click', () => {
    SerialEngine.connect();
});

DOM.btnSerialClose.addEventListener('click', () => {
    SerialEngine.disconnect();
});

DOM.serialProtocol.addEventListener('change', () => {
    SerialEngine.rawBuffer = [];
    SerialEngine.textBuffer = '';
});

DOM.serialBaud.addEventListener('change', () => {
    if (STATE.serial.connected) {
        console.log("检测到波特率改变，正在重新调整时基...");
        SerialEngine.switchMode(true); 
    }
});

// ==========================================
// FFT 频谱分析仪参数调节面板 (已全部改为 classList 切换)
// ==========================================

STATE.fft.maxFreq = 8000;
STATE.fft.gain = 100;
STATE.fft.logScale = false; 

DOM.btnFftToggle.onclick = () => {
    STATE.fft.on = !STATE.fft.on;
    DOM.btnFftToggle.innerText = STATE.fft.on ? "📊 频谱模式 (ON)" : "📊 频谱模式 (OFF)";
    
    if (STATE.fft.on) DOM.btnFftToggle.classList.add('active');
    else DOM.btnFftToggle.classList.remove('active');
    
    document.getElementById('fft-controls').style.display = STATE.fft.on ? 'flex' : 'none';
};

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

// ==========================================
// 串口声音数据可听化 (已全部改为 classList 切换)
// ==========================================

STATE.serial.speaker = false;
const btnSerialSpk = document.getElementById('btn-serial-spk');
if (btnSerialSpk) {
    btnSerialSpk.addEventListener('click', () => {
        initAudio(); 
        if (AudioState.audioCtx && AudioState.audioCtx.state === 'suspended') {
            AudioState.audioCtx.resume();
        }
        
        STATE.serial.speaker = !STATE.serial.speaker;
        
        if (STATE.serial.speaker) {
            btnSerialSpk.innerText = '🔊 监听中';
            btnSerialSpk.classList.add('active');
            SerialEngine.audioNextTime = 0; 
        } else {
            btnSerialSpk.innerText = '🔈 监听';
            btnSerialSpk.classList.remove('active');
            SerialEngine.audioAccumL = [];
            SerialEngine.audioAccumR = [];
        }
    });
}

draw();