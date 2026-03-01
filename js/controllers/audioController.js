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
    if (DOM.genTypeSel) DOM.genTypeSel.addEventListener('change', (e) => { const ch = getInputCh(); STATE['ch' + ch].genType = e.target.value; rebuildChannel(ch); });
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
        if (STATE.awgMonitor) { this.innerText = '🔊 扬声器: 开'; this.classList.add('active'); AudioState.awgSpeakerGain.gain.value = 1.0; } 
        else { this.innerText = '🔈 扬声器: 关'; this.classList.remove('active'); AudioState.awgSpeakerGain.gain.value = 0; }
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
            if (!AudioState.audioBuffer) return; 
            playBuffer(null, (parseFloat(e.target.value) / 100) * AudioState.audioBuffer.duration); 
            AudioState.isSeeking = false; 
        });
    }

    if (DOM.knobAudioSpeed) DOM.knobAudioSpeed.addEventListener('input', function (e) { 
        let speed = getLogSpeed(parseFloat(e.target.value)); 
        if (DOM.lblAudioSpeed) DOM.lblAudioSpeed.innerText = (speed < 0.01 ? speed.toFixed(3) : speed.toFixed(2)) + 'x'; 
        if (AudioState.bufferSource && AudioState.isMusicPlaying) { 
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
        if (!AudioState.audioBuffer) return;
        if (AudioState.isMusicPlaying) { 
            let cur = getCurrentTime(); 
            if (AudioState.bufferSource) { try { AudioState.bufferSource.stop(); } catch (e) { } AudioState.bufferSource.disconnect(); AudioState.bufferSource = null; } 
            AudioState.startOffset = cur; AudioState.isMusicPlaying = false; this.innerText = ' ▶ '; 
        } else { playBuffer(null, AudioState.startOffset); }
    });

    if (DOM.knobAudioSpeed) DOM.knobAudioSpeed.dispatchEvent(new Event('input')); 
}