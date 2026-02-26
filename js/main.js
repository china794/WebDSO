// 🚀 补上缺失的 Buffers
import { STATE, CONFIG, DOM, updateTriggerUI, showSysModal, Buffers } from './core.js';
import { AudioState, initAudio, rebuildChannel, updateAWG, playBuffer, getLogSpeed, getCurrentTime } from './audio.js';
import { resize, draw } from './render.js';
import { SerialEngine } from './serial.js';

// --- 全局工具监听与绑定 ---
const bindToggle = (domEl, prop, cb) => {
    domEl.addEventListener('click', () => { prop.on = !prop.on; domEl.classList.toggle('active', prop.on); if (cb) cb(); });
};
const bindKnob = (domInput, domLbl, domOsd, fmt, act) => {
    domInput.addEventListener('input', (e) => { let v = parseFloat(e.target.value); if (domLbl) domLbl.innerText = fmt(v); if (domOsd) domOsd.innerText = fmt(v); act(v); });
};

window.addEventListener('resize', resize);
resize();

DOM.btnRunstop.addEventListener('click', function () {
    STATE.run = !STATE.run;
    if (STATE.run) { this.classList.remove('stopped'); DOM.osdRunState.innerText = "run"; DOM.osdRunState.style.background = "#22c55e"; DOM.osdRunState.style.color = "#000"; } 
    else { this.classList.add('stopped'); DOM.osdRunState.innerText = "stop"; DOM.osdRunState.style.background = "#ef4444"; DOM.osdRunState.style.color = "#fff"; }
});

bindToggle(DOM.btnCh1, STATE.ch1); bindToggle(DOM.btnCh2, STATE.ch2);
bindToggle(DOM.btnMath, STATE.math, () => { DOM.osdMathBox.style.display = STATE.math.on ? 'flex' : 'none'; });

DOM.btnXy.addEventListener('click', function () { STATE.mode = 'XY'; this.classList.add('active'); DOM.btnDisplay.classList.remove('active'); });
DOM.btnDisplay.addEventListener('click', function () { STATE.mode = 'YT'; this.classList.add('active'); DOM.btnXy.classList.remove('active'); });
DOM.btnMeasure.addEventListener('click', function () { STATE.measure = !STATE.measure; this.classList.toggle('active'); DOM.measurePanel.style.display = STATE.measure ? 'flex' : 'none'; });

DOM.btnCursors.addEventListener('click', function () {
    STATE.cursor.mode = (STATE.cursor.mode + 1) % 3;
    this.innerText = ['光标: 关', '光标: Y轴(电压)', '光标: X轴(时间)'][STATE.cursor.mode];
    if (STATE.cursor.mode === 0) { this.classList.remove('active'); this.style.color = '#d1d5db'; } 
    else if (STATE.cursor.mode === 1) { this.classList.add('active'); this.style.color = '#a855f7'; } 
    else { this.classList.add('active'); this.style.color = '#38bdf8'; }
});

DOM.btnTrigEn.addEventListener('click', function () {
    STATE.trigger.enabled = !STATE.trigger.enabled;
    if (STATE.trigger.enabled) { this.innerText = '触发: 开'; this.style.color = '#4ade80'; this.classList.add('active'); } 
    else { this.innerText = '触发: 关'; this.style.color = '#d1d5db'; this.classList.remove('active'); window._frozenTriggerIdx = -1; }
});

bindKnob(DOM.knobPos1, DOM.lblPos1, null, v => v.toFixed(2), v => STATE.ch1.pos = v);
DOM.numScale1.addEventListener('change', (e) => { let v = parseFloat(e.target.value); if (isNaN(v) || v <= 0) v = 0.25; e.target.value = v.toFixed(2); STATE.ch1.scale = 1 / v; DOM.osdCh1Scale.innerText = v.toFixed(2) + 'V'; updateTriggerUI(); });
DOM.cplCh1.addEventListener('change', e => { STATE.ch1.cpl = e.target.value; DOM.osdCpl1.innerText = e.target.value; });

bindKnob(DOM.knobPos2, DOM.lblPos2, null, v => v.toFixed(2), v => STATE.ch2.pos = v);
DOM.numScale2.addEventListener('change', (e) => { let v = parseFloat(e.target.value); if (isNaN(v) || v <= 0) v = 0.25; e.target.value = v.toFixed(2); STATE.ch2.scale = 1 / v; DOM.osdCh2Scale.innerText = v.toFixed(2) + 'V'; updateTriggerUI(); });
DOM.cplCh2.addEventListener('change', e => { STATE.ch2.cpl = e.target.value; DOM.osdCpl2.innerText = e.target.value; });

bindKnob(DOM.knobHpos, DOM.lblHpos, null, v => v.toFixed(1) + '%', v => STATE.hpos = v);

// js/main.js 里的相关部分
DOM.knobTimebase.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    STATE.secPerDiv = val;
    
    // 动态显示单位：如果是串口大数值，显示 ms；如果是音频小数值，也可以显示 ms
    const displayVal = val.toFixed(1) + "ms";
    DOM.lblTimebase.innerText = displayVal;
    if (DOM.osdTimebase) DOM.osdTimebase.innerText = displayVal;
});

DOM.trigSrc.addEventListener('change', e => { STATE.trigger.src = e.target.value; if (DOM.osdTriggerSrc) DOM.osdTriggerSrc.innerText = e.target.value; updateTriggerUI(); });
DOM.btnEdge.addEventListener('click', function () { STATE.trigger.edge *= -1; this.innerText = '边沿: ' + (STATE.trigger.edge === 1 ? '↗ 上升沿' : '↘ 下降沿'); if (DOM.osdTriggerEdge) { DOM.osdTriggerEdge.innerText = STATE.trigger.edge === 1 ? '↗' : '↘'; } });
DOM.knobTlevel.addEventListener('input', (e) => { let v = parseFloat(e.target.value); STATE.trigger.level = v; if (DOM.lblTlevel) DOM.lblTlevel.innerText = v.toFixed(2) + 'V'; if (DOM.osdTriggerLevel) DOM.osdTriggerLevel.innerText = v.toFixed(2) + 'V'; });

// 你原代码里有两次 btnAutoset 的挂载，我合并成一个执行块
// 🚀 真正的 Auto-Set 核心算法
DOM.btnAutoset.addEventListener('click', () => {
    if (!STATE.run) {
        showSysModal('提示', '请先运行示波器 (RUN) 以采集数据');
        return;
    }
    
    const data = Buffers.pData1; // 从已归一化的数据里取基准，或者读原数据
    const rawData = Buffers.dataL; // 分析原始物理电压流
    
    let max = -999, min = 999, sum = 0, crossings = 0;
    const scanLen = Math.min(8000, rawData.length);
    
    // 1. 扫描波形轮廓
    for(let i = 0; i < scanLen; i++) {
        let val = rawData[i];
        if (val > max) max = val;
        if (val < min) min = val;
        sum += val;
    }
    
    const dcOffset = sum / scanLen;
    const vpp = max - min;
    
    if (vpp < 0.02) {
        showSysModal('Auto-Set 失败', '信号太微弱或无信号，无法自动捕捉');
        return;
    }
    
    // 2. 自动匹配垂直档位 (让波形占据屏幕大约 4 个格子)
    let targetVPerDiv = vpp / 4.0; 
    let newScale = 1.0 / targetVPerDiv;
    newScale = Math.max(0.01, Math.min(1000, newScale)); // 限制极限范围
    
    STATE.ch1.scale = newScale;
    // 计算 Y 轴偏移，将波形强制拉回屏幕中心
    STATE.ch1.pos = -dcOffset * newScale * (2.0 / CONFIG.gridY); 
    
    // 3. 自动匹配水平时基 (测频)
    let prevVal = rawData[0] - dcOffset;
    for(let i = 1; i < scanLen; i++){
        let val = rawData[i] - dcOffset;
        if(prevVal < 0 && val >= 0) crossings++;
        prevVal = val;
    }
    
    const currentRate = (STATE.current && STATE.current.sampleRate) ? STATE.current.sampleRate : CONFIG.sampleRate;
    let freq = crossings > 1 ? (crossings * (currentRate / scanLen)) : 0;
    
    if (freq > 0) {
        // 目标：屏幕上显示大约 4 个完整的波形周期
        let periodMs = 1000.0 / freq; 
        let targetSecPerDiv = (periodMs * 4) / CONFIG.gridX; 
        
        targetSecPerDiv = Math.max(0.1, Math.min(1000, targetSecPerDiv));
        STATE.secPerDiv = targetSecPerDiv;
        DOM.knobTimebase.value = targetSecPerDiv;
        
        const timeStr = targetSecPerDiv.toFixed(2) + 'ms';
        DOM.lblTimebase.innerText = timeStr;
        if (DOM.osdTimebase) DOM.osdTimebase.innerText = timeStr;
    }
    
    // 4. 自动拉平触发器
    STATE.trigger.enabled = true;
    STATE.trigger.src = 'CH1';
    STATE.trigger.level = dcOffset; // 把触发线精准切在波形正中间
    
    // 5. 更新 UI 界面
    DOM.knobPos1.value = STATE.ch1.pos; 
    DOM.lblPos1.innerText = STATE.ch1.pos.toFixed(2);
    DOM.numScale1.value = targetVPerDiv.toFixed(2);
    DOM.osdCh1Scale.innerText = targetVPerDiv.toFixed(2) + 'V';
    
    DOM.btnTrigEn.innerText = '触发: 开'; 
    DOM.btnTrigEn.style.color = '#4ade80';
    DOM.btnTrigEn.classList.add('active');
    
    DOM.knobTlevel.value = dcOffset;
    if (DOM.lblTlevel) DOM.lblTlevel.innerText = dcOffset.toFixed(2) + 'V';
    
    updateTriggerUI();
    DOM.knobTimebase.dispatchEvent(new Event('input'));
});

DOM.btnMic.addEventListener('click', async function () {
    initAudio(); if (AudioState.audioCtx.state === 'suspended') await AudioState.audioCtx.resume();
    if (AudioState.micSource) { AudioState.micSource.disconnect(); if (AudioState.micStream) AudioState.micStream.getTracks().forEach(t => t.stop()); AudioState.micSource = null; AudioState.micStream = null; this.style.background = '#2a2d35'; this.innerText = '声卡输入'; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { return showSysModal('环境不支持', '当前浏览器禁止在非 HTTPS 下获取物理音频。'); }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 } });
        AudioState.micStream = stream; AudioState.micSource = AudioState.audioCtx.createMediaStreamSource(stream); AudioState.micSource.channelCount = 2; AudioState.micSource.channelCountMode = 'explicit'; AudioState.micSource.connect(AudioState.splitter); this.style.background = '#2563eb'; this.innerText = '已连接';
    } catch (e) { showSysModal('设备连接失败', e.message); }
});

const getNDC = (e) => {
    const rect = DOM.glCanvas.getBoundingClientRect(); let cX = e.clientX, cY = e.clientY;
    if (e.touches && e.touches.length > 0) { cX = e.touches[0].clientX; cY = e.touches[0].clientY; }
    return { x: (cX - rect.left) / rect.width * 2.0 - 1.0, y: -((cY - rect.top) / rect.height * 2.0 - 1.0) };
};
const startCursorDrag = (e) => {
    if (STATE.cursor.mode === 0) return;
    const { x, y } = getNDC(e); const thr = 0.15;
    if (STATE.cursor.mode === 1) { if (Math.abs(y - STATE.cursor.v1) < thr) STATE.cursor.dragging = 'v1'; else if (Math.abs(y - STATE.cursor.v2) < thr) STATE.cursor.dragging = 'v2'; } 
    else if (STATE.cursor.mode === 2) { if (Math.abs(x - STATE.cursor.t1) < thr) STATE.cursor.dragging = 't1'; else if (Math.abs(x - STATE.cursor.t2) < thr) STATE.cursor.dragging = 't2'; }
};
const doCursorDrag = (e) => {
    if (!STATE.cursor.dragging) return; e.preventDefault(); const { x, y } = getNDC(e);
    if (STATE.cursor.dragging.startsWith('v')) { STATE.cursor[STATE.cursor.dragging] = Math.max(-1, Math.min(1, y)); } else { STATE.cursor[STATE.cursor.dragging] = Math.max(-1, Math.min(1, x)); }
};
const endCursorDrag = () => { STATE.cursor.dragging = null; };

DOM.glCanvas.addEventListener('mousemove', (e) => {
    const rect = DOM.glCanvas.getBoundingClientRect();
    if (STATE.cursor.dragging) { STATE.hover.active = false; return; }
    STATE.hover.x = e.clientX - rect.left; STATE.hover.y = e.clientY - rect.top; STATE.hover.active = true;
});
DOM.glCanvas.addEventListener('mouseleave', () => { STATE.hover.active = false; });
DOM.glCanvas.addEventListener('mousedown', startCursorDrag); window.addEventListener('mousemove', doCursorDrag, { passive: false }); window.addEventListener('mouseup', endCursorDrag);
DOM.glCanvas.addEventListener('touchstart', startCursorDrag, { passive: true }); window.addEventListener('touchmove', doCursorDrag, { passive: false }); window.addEventListener('touchend', endCursorDrag);

const bindFreqControl = (ch) => {
    const slider = DOM[`knobGenFreq${ch}`], numBox = DOM[`numGenFreq${ch}`];
    slider.addEventListener('input', (e) => { let freq = Math.round(Math.pow(10, e.target.value / 100)); numBox.value = freq; updateAWG(ch, freq); });
    numBox.addEventListener('change', (e) => { let freq = parseFloat(e.target.value); if (isNaN(freq) || freq < 1) freq = 1; let maxFreq = CONFIG.sampleRate / 2; if (freq > maxFreq) freq = maxFreq; numBox.value = freq; slider.value = Math.log10(freq) * 100; updateAWG(ch, freq); });
    DOM[`genType${ch}`].addEventListener('change', () => { updateAWG(ch, parseFloat(numBox.value)); });
};
bindFreqControl(1); bindFreqControl(2);

const bindAmpControl = (ch) => {
    const slider = DOM[`knobGenAmp${ch}`], numBox = DOM[`numGenAmp${ch}`];
    slider.addEventListener('input', (e) => { let amp = parseFloat(e.target.value); numBox.value = amp.toFixed(2); if (ch === 1 && AudioState.awgGain1) AudioState.awgGain1.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime); if (ch === 2 && AudioState.awgGain2) AudioState.awgGain2.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime); });
    numBox.addEventListener('change', (e) => { let amp = parseFloat(e.target.value); if (isNaN(amp) || amp < 0) amp = 0; if (amp > 20) amp = 20; numBox.value = amp.toFixed(2); slider.value = amp; if (ch === 1 && AudioState.awgGain1) AudioState.awgGain1.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime); if (ch === 2 && AudioState.awgGain2) AudioState.awgGain2.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime); });
};
bindAmpControl(1); bindAmpControl(2);

DOM.btnAwgSpk.addEventListener('click', function () {
    initAudio(); STATE.awgMonitor = !STATE.awgMonitor;
    if (STATE.awgMonitor) { this.style.color = '#4ade80'; this.innerText = '🔊 扬声器: 开'; AudioState.awgSpeakerGain.gain.value = 1.0; } 
    else { this.style.color = '#6b7280'; this.innerText = '🔈 扬声器: 关'; AudioState.awgSpeakerGain.gain.value = 0; }
});

const unlockAudio = () => { initAudio(); rebuildChannel(1); rebuildChannel(2); if (AudioState.audioCtx && AudioState.audioCtx.state === 'suspended') AudioState.audioCtx.resume(); document.removeEventListener('click', unlockAudio); }; 
document.addEventListener('click', unlockAudio);

if (DOM.btnCancelDownload) { DOM.btnCancelDownload.addEventListener('click', () => { if (AudioState.currentXHR) { AudioState.currentXHR.abort(); } document.getElementById('audio-loading-overlay').style.display = 'none'; DOM.btnAudioToggle.disabled = false; }); }
DOM.audioSeekBar.addEventListener('input', () => { AudioState.isSeeking = true; });
DOM.audioSeekBar.addEventListener('change', (e) => { if (!AudioState.audioBuffer) return; playBuffer(null, (parseFloat(e.target.value) / 100) * AudioState.audioBuffer.duration); AudioState.isSeeking = false; });
DOM.knobAudioSpeed.addEventListener('input', function (e) { let speed = getLogSpeed(parseFloat(e.target.value)); DOM.lblAudioSpeed.innerText = (speed < 0.01 ? speed.toFixed(3) : speed.toFixed(2)) + 'x'; if (AudioState.bufferSource && AudioState.isMusicPlaying) { AudioState.startOffset = getCurrentTime(); AudioState.startTime = AudioState.audioCtx.currentTime; AudioState.bufferSource.playbackRate.value = speed; } });
DOM.fileSelect.addEventListener('change', function (e) { const val = e.target.value; if (!val) return; if (val === 'LOCAL') { DOM.fileInput.click(); } else { playBuffer(val); } e.target.selectedIndex = 0; });
DOM.fileInput.addEventListener('change', function () { if (this.files[0]) playBuffer(this.files[0]); });
DOM.btnAudioToggle.addEventListener('click', function () {
    if (!AudioState.audioBuffer) return;
    if (AudioState.isMusicPlaying) { let cur = getCurrentTime(); if (AudioState.bufferSource) { try { AudioState.bufferSource.stop(); } catch (e) { } AudioState.bufferSource.disconnect(); AudioState.bufferSource = null; } AudioState.startOffset = cur; AudioState.isMusicPlaying = false; this.innerText = ' ▶ '; } 
    else { playBuffer(null, AudioState.startOffset); }
});

DOM.knobAudioSpeed.dispatchEvent(new Event('input')); DOM.cplCh1.dispatchEvent(new Event('change')); DOM.cplCh2.dispatchEvent(new Event('change')); updateTriggerUI();


[1, 2].forEach(ch => {
    const input = DOM['numScale' + ch]; const btnUp = document.getElementById('btn-s' + ch + '-up'); const btnDn = document.getElementById('btn-s' + ch + '-dn');
    if (btnUp && btnDn && input) {
        btnUp.addEventListener('click', () => { let v = parseFloat(input.value) || 0; input.value = (v + 0.05).toFixed(2); input.dispatchEvent(new Event('change')); });
        btnDn.addEventListener('click', () => { let v = parseFloat(input.value) || 0; if (v > 0.05) { input.value = (v - 0.05).toFixed(2); input.dispatchEvent(new Event('change')); } });
    }
});

DOM.osdSamplerate.innerText = (CONFIG.sampleRate / 1000).toFixed(1) + 'kSa/s (Audio)';


// 串口打开
DOM.btnSerialOpen.addEventListener('click', () => {
    SerialEngine.connect();
});

// 串口关闭
DOM.btnSerialClose.addEventListener('click', () => {
    SerialEngine.disconnect();
});

// 协议切换时重置缓冲区
DOM.serialProtocol.addEventListener('change', () => {
    SerialEngine.rawBuffer = [];
    SerialEngine.textBuffer = '';
});

DOM.serialBaud.addEventListener('change', () => {
    if (STATE.serial.connected) {
        console.log("检测到波特率改变，正在重新调整时基...");
        // 重新调用 switchMode 刷新采样率和 SEC/DIV 范围
        SerialEngine.switchMode(true); 
    }
});

// 🚀 FFT 面板交互与参数绑定
STATE.fft.maxFreq = 8000;
STATE.fft.gain = 100;

DOM.btnFftToggle.onclick = () => {
    STATE.fft.on = !STATE.fft.on;
    DOM.btnFftToggle.innerText = STATE.fft.on ? "📊 频谱模式 (ON)" : "📊 频谱模式 (OFF)";
    DOM.btnFftToggle.style.background = STATE.fft.on ? "#4ade80" : "#6366f1";
    // 展开或收起高级面板
    document.getElementById('fft-controls').style.display = STATE.fft.on ? 'flex' : 'none';
};

const fftMaxKnob = document.getElementById('knob-fft-max');
const fftMaxLbl = document.getElementById('lbl-fft-max');
fftMaxKnob.addEventListener('input', (e) => {
    STATE.fft.maxFreq = parseInt(e.target.value);
    fftMaxLbl.innerText = STATE.fft.maxFreq + 'Hz';
});

const fftGainKnob = document.getElementById('knob-fft-gain');
const fftGainLbl = document.getElementById('lbl-fft-gain');
fftGainKnob.addEventListener('input', (e) => {
    STATE.fft.gain = parseInt(e.target.value);
    fftGainLbl.innerText = 'x' + STATE.fft.gain;
});


draw();