/**
 * ==========================================
 * Audio Controller - 音频控制器
 * ==========================================
 * 负责处理音频输入、信号发生器、音频文件播放
 */

// TODO: 实现音频控制逻辑
import { STATE, DOM, CONFIG, showSysModal, CHANNEL_COUNT } from '../core.js';
import { GENERATOR, MATH } from '../constants.js';
import { AudioState, initAudio, rebuildChannel, updateAWG, rebuildStereoRouting, playBuffer, getLogSpeed, getCurrentTime } from '../audio.js';
import { refreshInputCard, getInputCh } from './inputController.js';

/**
 * 更新信号发生器专属参数区（gen-params-extra）的显隐。
 * 根据当前选中的波形类型，显示对应 data-for 的参数块。
 * （修复了原有 data-for 显隐无 JS 控制的死代码问题）
 */
function updateGenParamVisibility(genType) {
    document.querySelectorAll('#gen-params-extra .gen-param').forEach(el => {
        const forAttr = el.getAttribute('data-for');
        if (!forAttr) return;
        const show = forAttr.split(',').includes(genType);
        el.classList.toggle('visible', show);
    });
}

// 暴露给 inputController 的 refreshInputCard 调用（项目已有 __updateAutoPan 先例）
window.__updateGenParamVisibility = updateGenParamVisibility;

export function initAudioController() {
    // 麦克风输入
    if (DOM.btnMic) DOM.btnMic.addEventListener('click', async function () {
        await initAudio();
        if (AudioState.audioCtx.state === 'suspended') await AudioState.audioCtx.resume();
        
        if (AudioState.micSource) { 
            AudioState.micSource.disconnect(); 
            if (AudioState.micStream) AudioState.micStream.getTracks().forEach(t => t.stop()); 
            AudioState.micSource = null; AudioState.micStream = null; 
            this.classList.remove('active'); this.innerText = '声卡输入'; 
            return; 
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showSysModal('环境不支持', '当前浏览器禁止在非 HTTPS 下获取物理音频。'); 
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 } });
            AudioState.micStream = stream; 
            AudioState.micSource = AudioState.audioCtx.createMediaStreamSource(stream); 
            AudioState.micSource.channelCount = 2; AudioState.micSource.channelCountMode = 'explicit'; 
            AudioState.micSource.connect(AudioState.splitter); 
            this.classList.add('active'); this.innerText = '已连接';
        } catch (e) { showSysModal('设备连接失败', e.message); }
    });

    // AWG 内置发生器
    if (DOM.inputChSelect) DOM.inputChSelect.addEventListener('change', () => refreshInputCard(parseInt(DOM.inputChSelect.value)));

    if (DOM.knobGenFreqSel && DOM.numGenFreqSel) {
        DOM.knobGenFreqSel.addEventListener('input', (e) => {
            const ch = getInputCh(); let freq = Math.round(Math.pow(10, e.target.value / GENERATOR.FREQ_SLIDER_NORM));
            STATE['ch' + ch].genFreq = freq; DOM.numGenFreqSel.value = freq; updateAWG(ch, freq);
        });
        DOM.numGenFreqSel.addEventListener('change', (e) => {
            const ch = getInputCh(); let freq = parseFloat(e.target.value);
            if (isNaN(freq) || freq < 1) freq = 1; if (freq > CONFIG.sampleRate / MATH.NYQUIST_FACTOR) freq = CONFIG.sampleRate / MATH.NYQUIST_FACTOR;
            STATE['ch' + ch].genFreq = freq; DOM.numGenFreqSel.value = freq; DOM.knobGenFreqSel.value = Math.log10(freq) * 100; updateAWG(ch, freq);
        });
    }
    if (DOM.genTypeSel) DOM.genTypeSel.addEventListener('change', (e) => {
        const ch = getInputCh();
        STATE['ch' + ch].genType = e.target.value;
        updateGenParamVisibility(e.target.value);
        rebuildChannel(ch);
    });
    if (DOM.knobGenAmpSel && DOM.numGenAmpSel) {
        DOM.knobGenAmpSel.addEventListener('input', (e) => {
            const ch = getInputCh(); let amp = parseFloat(e.target.value);
            STATE['ch' + ch].genAmp = amp; DOM.numGenAmpSel.value = amp.toFixed(2);
            const g = AudioState['awgGain' + ch]; if (g && AudioState.audioCtx) g.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime);
        });
        DOM.numGenAmpSel.addEventListener('change', (e) => {
            const ch = getInputCh(); let amp = parseFloat(e.target.value);
            if (isNaN(amp) || amp < 0) amp = 0; if (amp > GENERATOR.MAX_AMP) amp = GENERATOR.MAX_AMP;
            STATE['ch' + ch].genAmp = amp; DOM.numGenAmpSel.value = amp.toFixed(2); DOM.knobGenAmpSel.value = amp;
            const g = AudioState['awgGain' + ch]; if (g && AudioState.audioCtx) g.gain.setValueAtTime(amp, AudioState.audioCtx.currentTime);
        });
    }
    
    if (DOM.awgOutLeft) DOM.awgOutLeft.addEventListener('change', (e) => { STATE.awgOutL = parseInt(e.target.value); initAudio(); rebuildStereoRouting(); });
    if (DOM.awgOutRight) DOM.awgOutRight.addEventListener('change', (e) => { STATE.awgOutR = parseInt(e.target.value); initAudio(); rebuildStereoRouting(); });
    
    if (DOM.btnAwgSpk) DOM.btnAwgSpk.addEventListener('click', function () {
        initAudio(); STATE.awgMonitor = !STATE.awgMonitor;
        // 只控制 AWG 监听路径 (awgSpeakerGain)。
        // 注意: 绝不能碰 panMaster —— 麦克风经 splitter→chMixer→panMaster 进扬声器,
        // 开启 panMaster 会导致声卡输入(麦克风)被放出来造成回声。
        // AWG 发生器的监听走 merger→awgSplitter→awgSpeakerGain, 与 panMaster 无关。
        if (STATE.awgMonitor) { this.innerText = '♪ 监听: 开'; this.classList.add('active'); AudioState.awgSpeakerGain.gain.value = 1.0; }
        else { this.innerText = '♪ 监听'; this.classList.remove('active'); AudioState.awgSpeakerGain.gain.value = 0; }
    });

    // 音频文件解析与播放控制
    const unlockAudio = () => { 
        initAudio(); for (let i = 1; i <= CHANNEL_COUNT; i++) rebuildChannel(i); 
        if (AudioState.audioCtx && AudioState.audioCtx.state === 'suspended') AudioState.audioCtx.resume(); 
        document.removeEventListener('click', unlockAudio); 
    }; 
    document.addEventListener('click', unlockAudio);

    if (DOM.btnCancelDownload) DOM.btnCancelDownload.addEventListener('click', () => { 
        if (AudioState.currentXHR) AudioState.currentXHR.abort(); 
        document.getElementById('audio-loading-overlay').style.display = 'none'; DOM.btnAudioToggle.disabled = false; 
    }); 

    if (DOM.audioSeekBar) {
        DOM.audioSeekBar.addEventListener('input', () => { AudioState.isSeeking = true; });
        DOM.audioSeekBar.addEventListener('change', (e) => {
            const pct = parseFloat(e.target.value) / 100;
            if (AudioState.streamingMode && AudioState.audioElement) {
                // <audio> 流式模式：直接跳转 currentTime
                const dur = AudioState.audioElement.duration;
                if (dur && isFinite(dur)) AudioState.audioElement.currentTime = pct * dur;
            } else if (AudioState.audioBuffer) {
                playBuffer(null, pct * AudioState.audioBuffer.duration);
            }
            AudioState.isSeeking = false;
        });
    }

    if (DOM.knobAudioSpeed) DOM.knobAudioSpeed.addEventListener('input', function (e) {
        let speed = getLogSpeed(parseFloat(e.target.value));
        if (DOM.lblAudioSpeed) DOM.lblAudioSpeed.innerText = (speed < 0.01 ? speed.toFixed(3) : speed.toFixed(2)) + 'x';
        if (AudioState.streamingMode && AudioState.audioElement) {
            // <audio> 流式模式：直接设 playbackRate（钳制到元素支持范围）
            AudioState.audioElement.playbackRate = Math.max(0.0625, Math.min(16, speed));
        } else if (AudioState.bufferSource && AudioState.isMusicPlaying) {
            AudioState.startOffset = getCurrentTime(); AudioState.startTime = AudioState.audioCtx.currentTime;
            AudioState.bufferSource.playbackRate.value = speed;
        }
    });

    if (DOM.fileSelect) DOM.fileSelect.addEventListener('change', function (e) { 
        const val = e.target.value; if (!val) return; 
        if (val === 'LOCAL') DOM.fileInput.click(); else playBuffer(val); 
        e.target.selectedIndex = 0; 
    });

    if (DOM.fileInput) DOM.fileInput.addEventListener('change', function () { if (this.files[0]) playBuffer(this.files[0]); });

    if (DOM.btnAudioToggle) DOM.btnAudioToggle.addEventListener('click', function () {
        // <audio> 流式降级模式
        if (AudioState.streamingMode && AudioState.audioElement) {
            if (AudioState.isMusicPlaying) {
                AudioState.audioElement.pause();
                AudioState.isMusicPlaying = false;
                this.innerText = ' ▶ ';
            } else {
                AudioState.audioElement.play().catch(() => {});
                AudioState.isMusicPlaying = true;
                this.innerText = ' ⏸ ';
            }
            return;
        }
        // 正常 decodeAudioData 模式
        if (!AudioState.audioBuffer) return;
        if (AudioState.isMusicPlaying) {
            let cur = getCurrentTime();
            if (AudioState.bufferSource) { try { AudioState.bufferSource.stop(); } catch (e) { } AudioState.bufferSource.disconnect(); AudioState.bufferSource = null; }
            AudioState.startOffset = cur; AudioState.isMusicPlaying = false; this.innerText = ' ▶ ';
        } else { playBuffer(null, AudioState.startOffset); }
    });

    if (DOM.knobAudioSpeed) DOM.knobAudioSpeed.dispatchEvent(new Event('input')); 
}