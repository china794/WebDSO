import { STATE, CONFIG, DOM, updateTriggerUI, showSysModal, Buffers, CHANNEL_COUNT } from './core.js';
import { AudioState, initAudio, rebuildChannel, updateAWG, rebuildStereoRouting, playBuffer, getLogSpeed, getCurrentTime } from './audio.js';
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

    btnThemeToggle.addEventListener('click', (event) => {
        // 兼容性处理：如果浏览器不支持 View Transitions API，则直接切换
        if (!document.startViewTransition) {
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
            return;
        }

        // 获取点击的坐标，作为圆心的起点
        const x = event.clientX;
        const y = event.clientY;

        // 计算扩散的最大半径：从点击处到屏幕最远角的距离 (勾股定理)
        const endRadius = Math.hypot(
            Math.max(x, innerWidth - x),
            Math.max(y, innerHeight - y)
        );

        // 开启视图过渡
        const transition = document.startViewTransition(() => {
            // 在这里进行状态的实际改变
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

        // 等待新视图准备好后，注入自定义动画
        transition.ready.then(() => {
            const clipPath = [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`
            ];

            // 使用 Web Animations API 控制 ::view-transition-new(root) 的形变
            document.documentElement.animate(
                {
                    clipPath: clipPath,
                },
                {
                    duration: 500,       // 动画持续时间（毫秒）
                    easing: 'ease-out',  // 缓动函数
                    pseudoElement: '::view-transition-new(root)' // 指定只让新视图进行圆形扩散
                }
            );
        });
    });
}

/**
 * ==========================================
 * 全局工具监听与绑定函数
 * ==========================================
 */

/** 绑定开关类按钮：点击切换 prop.on，并执行可选回调 */
const bindToggle = (domEl, prop, cb) => {
    domEl.addEventListener('click', () => {
        prop.on = !prop.on;
        domEl.classList.toggle('active', prop.on);
        if (cb) cb();
    });
};

/** 绑定旋钮/滑块：input 时更新标签并执行 act 回调 */
const bindKnob = (domInput, domLbl, domOsd, fmt, act) => {
    domInput.addEventListener('input', (e) => {
        let v = parseFloat(e.target.value);
        if (domLbl) domLbl.innerText = fmt(v);
        if (domOsd) domOsd.innerText = fmt(v);
        act(v);
    });
};

// ==========================================
// 垂直 / 输入：下拉选择 + 单卡片
// ==========================================
const txtClass = (n) => `txt-ch${n}`;

let currentSelectedCh = 1;

function refreshVerticalCard(ch) {
    const c = STATE['ch' + ch];
    if (!c || !DOM.verticalChSelect) return;
    currentSelectedCh = ch;
    DOM.verticalChSelect.value = String(ch);
    
    for (let i = 1; i <= 8; i++) {
        const btn = DOM['ch' + i + 'Toggle'];
        if (btn) {
            const chState = STATE['ch' + i];
            btn.classList.toggle('active', chState.on);
        }
    }
    
    DOM.knobPosSel.value = c.pos;
    DOM.lblPosSel.innerText = c.pos.toFixed(2);
    const vPerDiv = 1 / c.scale;
    DOM.numScaleSel.value = vPerDiv.toFixed(2);
    DOM.cplChSel.value = c.cpl;
}

function refreshInputCard(ch) {
    const c = STATE['ch' + ch];
    if (!c || !DOM.inputChSelect) return;
    DOM.inputChSelect.value = String(ch);
    DOM.inputGenLabel.innerText = 'CH' + ch;
    DOM.inputGenLabel.className = 'txt-ch' + ch + ' font-mono';
    DOM.inputGenLabel.classList.remove('txt-ch1','txt-ch2','txt-ch3','txt-ch4','txt-ch5','txt-ch6','txt-ch7','txt-ch8');
    DOM.inputGenLabel.classList.add('txt-ch' + ch);
    DOM.genTypeSel.value = c.genType || 'off';
    DOM.numGenFreqSel.value = c.genFreq ?? 1000;
    DOM.knobGenFreqSel.value = Math.log10(c.genFreq || 1000) * 100;
    DOM.numGenAmpSel.value = (c.genAmp ?? 0.5).toFixed(2);
    DOM.knobGenAmpSel.value = c.genAmp ?? 0.5;
}

// 重新收集 DOM 引用（新控件）
document.querySelectorAll('[id]').forEach(el => {
    const camelCaseId = el.id.replace(/-([a-z0-9])/g, (g) => g[1].toUpperCase());
    if (!DOM[camelCaseId]) DOM[camelCaseId] = el;
});

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

// 垂直区：下拉切换 + 开关按钮 + 单卡片通道控制
if (DOM.verticalChSelect) {
    DOM.verticalChSelect.addEventListener('change', () => refreshVerticalCard(parseInt(DOM.verticalChSelect.value)));
}
for (let i = 1; i <= 8; i++) {
    const btn = DOM['ch' + i + 'Toggle'];
    if (btn) {
        btn.addEventListener('click', () => {
            STATE['ch' + i].on = !STATE['ch' + i].on;
            refreshVerticalCard(currentSelectedCh);
        });
    }
}

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

// 垂直区：POS / SCALE / CPL 绑定到当前选中通道
if (DOM.knobPosSel && DOM.lblPosSel) {
    bindKnob(DOM.knobPosSel, DOM.lblPosSel, null, v => v.toFixed(2), v => {
        const ch = parseInt(DOM.verticalChSelect?.value || currentSelectedCh);
        STATE['ch' + ch].pos = v;
    });
}
if (DOM.numScaleSel) {
    DOM.numScaleSel.addEventListener('change', (e) => {
        const ch = parseInt(DOM.verticalChSelect?.value || currentSelectedCh);
        let v = parseFloat(e.target.value);
        if (isNaN(v) || v <= 0) v = 0.25;
        e.target.value = v.toFixed(2);
        STATE['ch' + ch].scale = 1 / v;
        updateTriggerUI();
    });
}
if (DOM.cplChSel) {
    DOM.cplChSel.addEventListener('change', e => {
        const ch = parseInt(DOM.verticalChSelect?.value || currentSelectedCh);
        STATE['ch' + ch].cpl = e.target.value;
    });
}
if (DOM.btnSelUp && DOM.btnSelDn && DOM.numScaleSel) {
    DOM.btnSelUp.addEventListener('click', () => {
        let v = parseFloat(DOM.numScaleSel.value) || 0;
        DOM.numScaleSel.value = (v + 0.05).toFixed(2);
        DOM.numScaleSel.dispatchEvent(new Event('change'));
    });
    DOM.btnSelDn.addEventListener('click', () => {
        let v = parseFloat(DOM.numScaleSel.value) || 0;
        if (v > 0.05) { DOM.numScaleSel.value = (v - 0.05).toFixed(2); DOM.numScaleSel.dispatchEvent(new Event('change')); }
    });
}

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
    
    const scanLen = Math.min(8000, Buffers.data1.length);
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

    const stats = Array.from({ length: CHANNEL_COUNT }, (_, i) => analyzeChannel(Buffers['data' + (i + 1)]));
    const anyValid = stats.some(s => s.valid);
    if (!anyValid) {
        showSysModal('Auto-Set 失败', '所有通道信号均太微弱或无信号，无法自动捕捉');
        return;
    }

    let targetVPerDiv = 0.01;
    for (let i = 0; i < CHANNEL_COUNT; i++) {
        const ch = STATE['ch' + (i + 1)];
        if (stats[i].valid && ch.on) targetVPerDiv = Math.max(targetVPerDiv, stats[i].vpp / 4.0);
    }
    let unifiedScale = Math.max(0.01, Math.min(1000, 1.0 / targetVPerDiv));

    for (let i = 0; i < CHANNEL_COUNT; i++) {
        const n = i + 1, ch = STATE['ch' + n];
        if (stats[i].valid && ch.on) {
            ch.scale = unifiedScale;
            ch.pos = -stats[i].dcOffset * unifiedScale * (2.0 / CONFIG.gridY);
        }
    }
    refreshVerticalCard(currentSelectedCh);

    let masterFreq = 0, trigSrc = 'CH1', trigOffset = 0, bestVpp = 0;
    for (let i = 0; i < CHANNEL_COUNT; i++) {
        const ch = STATE['ch' + (i + 1)];
        if (stats[i].valid && ch.on && stats[i].vpp > bestVpp) {
            bestVpp = stats[i].vpp;
            masterFreq = stats[i].freq;
            trigSrc = 'CH' + (i + 1);
            trigOffset = stats[i].dcOffset;
        }
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

/** 将鼠标/触摸事件坐标转换为 NDC (-1 ~ 1) */
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

/** 检测光标拖拽起始：判断是否点中某条光标线 */
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

/** 执行光标拖拽：根据 dragging 类型更新对应坐标 */
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

/** 结束光标拖拽 */
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

// 输入区：下拉切换 + 单组控件
if (DOM.inputChSelect) {
    DOM.inputChSelect.addEventListener('change', () => refreshInputCard(parseInt(DOM.inputChSelect.value)));
}

const getInputCh = () => parseInt(DOM.inputChSelect?.value || 1);

if (DOM.knobGenFreqSel && DOM.numGenFreqSel) {
    DOM.knobGenFreqSel.addEventListener('input', (e) => {
        const ch = getInputCh();
        let freq = Math.round(Math.pow(10, e.target.value / 100));
        STATE['ch' + ch].genFreq = freq;
        DOM.numGenFreqSel.value = freq;
        updateAWG(ch, freq);
    });
    DOM.numGenFreqSel.addEventListener('change', (e) => {
        const ch = getInputCh();
        let freq = parseFloat(e.target.value);
        if (isNaN(freq) || freq < 1) freq = 1;
        if (freq > CONFIG.sampleRate / 2) freq = CONFIG.sampleRate / 2;
        STATE['ch' + ch].genFreq = freq;
        DOM.numGenFreqSel.value = freq;
        DOM.knobGenFreqSel.value = Math.log10(freq) * 100;
        updateAWG(ch, freq);
    });
}
if (DOM.genTypeSel) {
    DOM.genTypeSel.addEventListener('change', (e) => {
        const ch = getInputCh();
        STATE['ch' + ch].genType = e.target.value;
        rebuildChannel(ch);
    });
}
if (DOM.knobGenAmpSel && DOM.numGenAmpSel) {
    DOM.knobGenAmpSel.addEventListener('input', (e) => {
        const ch = getInputCh();
        let amp = parseFloat(e.target.value);
        STATE['ch' + ch].genAmp = amp;
        DOM.numGenAmpSel.value = amp.toFixed(2);
        const g = AudioState['awgGain' + ch];
        if (g && AudioState.audioCtx) g.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime);
    });
    DOM.numGenAmpSel.addEventListener('change', (e) => {
        const ch = getInputCh();
        let amp = parseFloat(e.target.value);
        if (isNaN(amp) || amp < 0) amp = 0;
        if (amp > 20) amp = 20;
        STATE['ch' + ch].genAmp = amp;
        DOM.numGenAmpSel.value = amp.toFixed(2);
        DOM.knobGenAmpSel.value = amp;
        const g = AudioState['awgGain' + ch];
        if (g && AudioState.audioCtx) g.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime);
    });
}

// 双声道输出：左/右通道选择
if (DOM.awgOutLeft) {
    DOM.awgOutLeft.addEventListener('change', (e) => {
        STATE.awgOutL = parseInt(e.target.value);
        initAudio();
        rebuildStereoRouting();
    });
}
if (DOM.awgOutRight) {
    DOM.awgOutRight.addEventListener('change', (e) => {
        STATE.awgOutR = parseInt(e.target.value);
        initAudio();
        rebuildStereoRouting();
    });
}

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

/** 首次用户交互时解锁 Web Audio 上下文 (浏览器策略要求) */
const unlockAudio = () => { 
    initAudio(); 
    for (let i = 1; i <= CHANNEL_COUNT; i++) rebuildChannel(i); 
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
if (DOM.cplChSel) DOM.cplChSel.dispatchEvent(new Event('change'));
updateTriggerUI();

refreshVerticalCard(1);
refreshInputCard(1);

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

// 串口双声道输出：左/右通道选择
if (DOM.serialOutLeft) {
    DOM.serialOutLeft.addEventListener('change', (e) => {
        STATE.serialOutL = parseInt(e.target.value);
        initAudio();
    });
}
if (DOM.serialOutRight) {
    DOM.serialOutRight.addEventListener('change', (e) => {
        STATE.serialOutR = parseInt(e.target.value);
        initAudio();
    });
}

draw();