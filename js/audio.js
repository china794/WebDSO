import { CONFIG, DOM, showSysModal } from './core.js';

export const AudioState = {
    audioCtx: null, splitter: null, merger: null, micSource: null, micStream: null,
    fileSourceNode: null, musicGainNode: null,
    awgOsc1: null, awgGain1: null, awgOsc2: null, awgGain2: null, awgSpeakerGain: null,
    analyserL_DC: null, analyserR_DC: null, analyserL_AC: null, analyserR_AC: null, ch1Mixer: null, ch2Mixer: null,
    audioBuffer: null, bufferSource: null, startTime: 0, startOffset: 0, isSeeking: false, isMusicPlaying: false, currentXHR: null
};

export function initAudio() {
    if (!AudioState.audioCtx) {
        AudioState.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: CONFIG.sampleRate, latencyHint: 'interactive' });
        AudioState.ch1Mixer = AudioState.audioCtx.createGain(); AudioState.ch2Mixer = AudioState.audioCtx.createGain();
        
        AudioState.analyserL_DC = AudioState.audioCtx.createAnalyser(); AudioState.analyserL_DC.fftSize = CONFIG.fftSize;
        AudioState.analyserR_DC = AudioState.audioCtx.createAnalyser(); AudioState.analyserR_DC.fftSize = CONFIG.fftSize;
        AudioState.analyserL_AC = AudioState.audioCtx.createAnalyser(); AudioState.analyserL_AC.fftSize = CONFIG.fftSize;
        AudioState.analyserR_AC = AudioState.audioCtx.createAnalyser(); AudioState.analyserR_AC.fftSize = CONFIG.fftSize;
        
        let hpL = AudioState.audioCtx.createBiquadFilter(); hpL.type = 'highpass'; hpL.frequency.value = 10;
        let hpR = AudioState.audioCtx.createBiquadFilter(); hpR.type = 'highpass'; hpR.frequency.value = 10;
        
        AudioState.ch1Mixer.connect(AudioState.analyserL_DC); AudioState.ch1Mixer.connect(hpL); hpL.connect(AudioState.analyserL_AC);
        AudioState.ch2Mixer.connect(AudioState.analyserR_DC); AudioState.ch2Mixer.connect(hpR); hpR.connect(AudioState.analyserR_AC);
        
        window.dcBias1 = AudioState.audioCtx.createConstantSource(); window.dcBias1.offset.value = 0.000001; window.dcBias1.connect(AudioState.ch1Mixer); window.dcBias1.start();
        window.dcBias2 = AudioState.audioCtx.createConstantSource(); window.dcBias2.offset.value = 0.000001; window.dcBias2.connect(AudioState.ch2Mixer); window.dcBias2.start();
        
        AudioState.splitter = AudioState.audioCtx.createChannelSplitter(2);
        AudioState.splitter.connect(AudioState.ch1Mixer, 0); AudioState.splitter.connect(AudioState.ch2Mixer, 1);
        
        AudioState.merger = AudioState.audioCtx.createChannelMerger(2);
        AudioState.awgSpeakerGain = AudioState.audioCtx.createGain(); AudioState.awgSpeakerGain.gain.value = 0;
        AudioState.merger.connect(AudioState.awgSpeakerGain); AudioState.awgSpeakerGain.connect(AudioState.audioCtx.destination);
        
        AudioState.musicGainNode = AudioState.audioCtx.createGain(); AudioState.musicGainNode.gain.value = 1;
        AudioState.musicGainNode.connect(AudioState.splitter); AudioState.musicGainNode.connect(AudioState.audioCtx.destination);
    }
}

export function rebuildChannel(ch) {
    let type = DOM['genType' + ch].value;
    let target = ch === 1 ? AudioState.ch1Mixer : AudioState.ch2Mixer;
    
    if (ch === 1 && AudioState.awgOsc1) { AudioState.awgOsc1.stop(); AudioState.awgOsc1.disconnect(); AudioState.awgOsc1 = null; if (AudioState.awgGain1) { AudioState.awgGain1.disconnect(); AudioState.awgGain1 = null; } }
    if (ch === 2 && AudioState.awgOsc2) { AudioState.awgOsc2.stop(); AudioState.awgOsc2.disconnect(); AudioState.awgOsc2 = null; if (AudioState.awgGain2) { AudioState.awgGain2.disconnect(); AudioState.awgGain2 = null; } }
    
    if (type === 'off') return;
    
    let freq = parseFloat(DOM['numGenFreq' + ch].value);
    let amp = parseFloat(DOM['knobGenAmp' + ch].value);
    let osc = AudioState.audioCtx.createOscillator(), gain = AudioState.audioCtx.createGain();
    gain.gain.value = amp; osc.type = type; osc.frequency.value = freq;
    osc.connect(gain); gain.connect(target); gain.connect(AudioState.merger, 0, ch === 1 ? 0 : 1);
    osc.start();
    
    if (ch === 1) { AudioState.awgOsc1 = osc; AudioState.awgGain1 = gain; } 
    else { AudioState.awgOsc2 = osc; AudioState.awgGain2 = gain; }
}

export function updateAWG(ch, freq) {
    initAudio();
    let otherCh = ch === 1 ? 2 : 1;
    let type = DOM['genType' + ch].value;
    let otherType = DOM['genType' + otherCh].value;
    let otherFreqElem = DOM['numGenFreq' + otherCh];
    let otherFreq = otherFreqElem ? parseFloat(otherFreqElem.value) : 0;
    let lock = (type !== 'off' && otherType !== 'off' && Math.abs(freq - otherFreq) < 0.5);

    if (lock) {
        if (window._lockActive && window._lockFreq === freq && window._lockType1 === type && window._lockType2 === otherType) return;
        if (AudioState.awgOsc1) { AudioState.awgOsc1.stop(); AudioState.awgOsc1.disconnect(); AudioState.awgOsc1 = null; }
        if (AudioState.awgOsc2) { AudioState.awgOsc2.stop(); AudioState.awgOsc2.disconnect(); AudioState.awgOsc2 = null; }
        if (AudioState.awgGain1) { AudioState.awgGain1.disconnect(); AudioState.awgGain1 = null; }
        if (AudioState.awgGain2) { AudioState.awgGain2.disconnect(); AudioState.awgGain2 = null; }

        let baseTime = AudioState.audioCtx.currentTime + 0.01;
        let osc1 = AudioState.audioCtx.createOscillator(); osc1.type = type; osc1.frequency.value = freq;
        let gain1 = AudioState.audioCtx.createGain(); gain1.gain.value = parseFloat(DOM.knobGenAmp1.value);
        osc1.connect(gain1); gain1.connect(AudioState.ch1Mixer); gain1.connect(AudioState.merger, 0, 0); osc1.start(baseTime);
        AudioState.awgOsc1 = osc1; AudioState.awgGain1 = gain1;

        let osc2 = AudioState.audioCtx.createOscillator(); osc2.type = otherType; osc2.frequency.value = freq;
        let gain2 = AudioState.audioCtx.createGain(); gain2.gain.value = parseFloat(DOM.knobGenAmp2.value);
        osc2.connect(gain2); gain2.connect(AudioState.ch2Mixer); gain2.connect(AudioState.merger, 0, 1); osc2.start(baseTime + 0.25 / freq);
        AudioState.awgOsc2 = osc2; AudioState.awgGain2 = gain2;

        window._lockActive = true; window._lockFreq = freq; window._lockType1 = type; window._lockType2 = otherType; return;
    }
    if (window._lockActive) {
        if (AudioState.awgOsc1) { AudioState.awgOsc1.stop(); AudioState.awgOsc1.disconnect(); AudioState.awgOsc1 = null; }
        if (AudioState.awgOsc2) { AudioState.awgOsc2.stop(); AudioState.awgOsc2.disconnect(); AudioState.awgOsc2 = null; }
        if (AudioState.awgGain1) { AudioState.awgGain1.disconnect(); AudioState.awgGain1 = null; }
        if (AudioState.awgGain2) { AudioState.awgGain2.disconnect(); AudioState.awgGain2 = null; }
        window._lockActive = false; rebuildChannel(1); rebuildChannel(2); return;
    }
    rebuildChannel(ch);
}

export function getLogSpeed(sliderVal) {
    const spd = 0.001 * Math.pow((2.0 / 0.001), sliderVal / 100); return (spd > 0.97 && spd < 1.03) ? 1.0 : spd;
}

export function getCurrentTime() {
    if (!AudioState.isMusicPlaying || !AudioState.audioBuffer || !AudioState.bufferSource || AudioState.audioCtx.state !== 'running') return AudioState.startOffset;
    return (AudioState.startOffset + (AudioState.audioCtx.currentTime - AudioState.startTime) * AudioState.bufferSource.playbackRate.value) % AudioState.audioBuffer.duration;
}

export function fetchWithProgress(url, onProgress) {
    return new Promise((resolve, reject) => {
        if (AudioState.currentXHR) AudioState.currentXHR.abort();
        const xhr = new XMLHttpRequest(); AudioState.currentXHR = xhr;
        xhr.open('GET', url); xhr.responseType = 'arraybuffer';
        xhr.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.floor((e.loaded / e.total) * 100)); };
        xhr.onload = () => { AudioState.currentXHR = null; if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response); else reject(new Error("网络请求失败: HTTP " + xhr.status)); };
        xhr.onerror = () => { AudioState.currentXHR = null; reject(new Error("网络请求异常")); };
        xhr.onabort = () => { AudioState.currentXHR = null; reject(new Error("ABORTED")); };
        xhr.send();
    });
}

export async function playBuffer(fileOrUrl, offset = 0) {
    initAudio();
    const overlay = document.getElementById('audio-loading-overlay');
    const progressBar = document.getElementById('audio-progress-bar');
    const loadingText = document.getElementById('audio-loading-text');

    try {
        if (fileOrUrl) {
            overlay.style.display = 'flex'; DOM.btnAudioToggle.disabled = true;
            let arrayBuffer;
            if (typeof fileOrUrl === 'string') {
                arrayBuffer = await fetchWithProgress(fileOrUrl, (percent) => { progressBar.style.width = percent + '%'; loadingText.innerText = `下载中... ${percent}%`; });
                loadingText.innerText = "解码音频中...";
            } else {
                if (AudioState.currentXHR) AudioState.currentXHR.abort();
                loadingText.innerText = "读取本地文件..."; arrayBuffer = await fileOrUrl.arrayBuffer();
            }
            AudioState.audioBuffer = await AudioState.audioCtx.decodeAudioData(arrayBuffer);
        }
        if (!AudioState.audioBuffer) return;
        if (AudioState.bufferSource) { try { AudioState.bufferSource.stop(); } catch (e) { } AudioState.bufferSource.disconnect(); }
        
        AudioState.bufferSource = AudioState.audioCtx.createBufferSource();
        AudioState.bufferSource.buffer = AudioState.audioBuffer;
        AudioState.bufferSource.loop = true;
        AudioState.bufferSource.playbackRate.value = getLogSpeed(parseFloat(DOM.knobAudioSpeed.value));
        
        AudioState.startOffset = offset; AudioState.startTime = AudioState.audioCtx.currentTime; AudioState.isMusicPlaying = true;
        
        AudioState.bufferSource.connect(AudioState.musicGainNode);
        AudioState.bufferSource.start(0, offset % AudioState.audioBuffer.duration);
        if (AudioState.audioCtx.state === 'suspended') await AudioState.audioCtx.resume();
    } catch (err) {
        if (err.message !== "ABORTED") showSysModal('加载失败', err.message); else console.log("上一个下载任务已被掐断");
    } finally {
        if (!AudioState.currentXHR) { overlay.style.display = 'none'; progressBar.style.width = '0%'; DOM.btnAudioToggle.innerText = ' ⏸ '; DOM.btnAudioToggle.disabled = false; }
    }
}