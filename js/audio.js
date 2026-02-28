import { CONFIG, DOM, showSysModal, CHANNEL_COUNT, STATE } from './core.js';

/**
 * ==========================================
 * 全局音频状态与节点管理器 (8 通道)
 * ==========================================
 */
export const AudioState = {
    audioCtx: null, splitter: null, merger: null,
    awgSplitter: null, stereoMerger: null,
    micSource: null, micStream: null,
    fileSourceNode: null, musicGainNode: null,
    awgSpeakerGain: null,
    audioBuffer: null, bufferSource: null, startTime: 0, startOffset: 0,
    isSeeking: false, isMusicPlaying: false, currentXHR: null
};

/**
 * 初始化 WebAudio 环境及拓扑网络
 * 将所有音频源连接到对应的分析器 (Analyser) 与混音器 (Mixer)
 */
export function initAudio() {
    if (!AudioState.audioCtx) {
        AudioState.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ 
            sampleRate: CONFIG.sampleRate, latencyHint: 'interactive' 
        });
        
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            AudioState['ch' + i + 'Mixer'] = AudioState.audioCtx.createGain();
            AudioState['analyser' + i + '_DC'] = AudioState.audioCtx.createAnalyser();
            AudioState['analyser' + i + '_DC'].fftSize = CONFIG.fftSize;
            AudioState['analyser' + i + '_AC'] = AudioState.audioCtx.createAnalyser();
            AudioState['analyser' + i + '_AC'].fftSize = CONFIG.fftSize;
            
            const hp = AudioState.audioCtx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = 10;
            AudioState['ch' + i + 'Mixer'].connect(AudioState['analyser' + i + '_DC']);
            AudioState['ch' + i + 'Mixer'].connect(hp);
            hp.connect(AudioState['analyser' + i + '_AC']);
            
            const bias = AudioState.audioCtx.createConstantSource();
            bias.offset.value = 0.000001;
            bias.connect(AudioState['ch' + i + 'Mixer']);
            bias.start();
        }
        
        AudioState.splitter = AudioState.audioCtx.createChannelSplitter(CHANNEL_COUNT);
        for (let i = 0; i < CHANNEL_COUNT; i++) {
            AudioState.splitter.connect(AudioState['ch' + (i + 1) + 'Mixer'], i);
        }
        
        AudioState.merger = AudioState.audioCtx.createChannelMerger(CHANNEL_COUNT);
        AudioState.awgSplitter = AudioState.audioCtx.createChannelSplitter(CHANNEL_COUNT);
        AudioState.stereoMerger = AudioState.audioCtx.createChannelMerger(2);
        AudioState.awgSpeakerGain = AudioState.audioCtx.createGain();
        AudioState.awgSpeakerGain.gain.value = 0;
        AudioState.merger.connect(AudioState.awgSplitter);
        rebuildStereoRouting();
        AudioState.stereoMerger.connect(AudioState.awgSpeakerGain);
        AudioState.awgSpeakerGain.connect(AudioState.audioCtx.destination);
        
        AudioState.musicGainNode = AudioState.audioCtx.createGain();
        AudioState.musicGainNode.gain.value = 1;
        AudioState.musicGainNode.connect(AudioState.splitter);
        AudioState.musicGainNode.connect(AudioState.audioCtx.destination);
    }
}

/** 根据 awgOutL/awgOutR 重建双声道路由 */
export function rebuildStereoRouting() {
    if (!AudioState.awgSplitter || !AudioState.stereoMerger || !AudioState.awgSpeakerGain) return;
    const L = (STATE.awgOutL || 1) - 1;
    const R = (STATE.awgOutR || 2) - 1;
    try { AudioState.awgSplitter.disconnect(); } catch (_) {}
    AudioState.awgSplitter.connect(AudioState.stereoMerger, L, 0);
    AudioState.awgSplitter.connect(AudioState.stereoMerger, R, 1);
}

/**
 * 重新构建指定通道的信号发生器 (AWG) 节点
 * @param {number} ch - 通道编号 (1-8)
 */
export function rebuildChannel(ch) {
    const chState = STATE['ch' + ch];
    if (!chState) return;
    let type = chState.genType || 'off';
    let target = AudioState['ch' + ch + 'Mixer'];
    
    const oldOsc = AudioState['awgOsc' + ch], oldGain = AudioState['awgGain' + ch];
    if (oldOsc) { oldOsc.stop(); oldOsc.disconnect(); AudioState['awgOsc' + ch] = null; }
    if (oldGain) { oldGain.disconnect(); AudioState['awgGain' + ch] = null; }
    
    if (type === 'off') return;
    
    let freq = chState.genFreq ?? 1000;
    let amp = chState.genAmp ?? 0.5;
    
    let osc = AudioState.audioCtx.createOscillator();
    let gain = AudioState.audioCtx.createGain();
    gain.gain.value = amp;
    osc.type = type;
    osc.frequency.value = freq;
    
    osc.connect(gain);
    gain.connect(target);
    gain.connect(AudioState.merger, 0, ch - 1);
    osc.start();
    
    AudioState['awgOsc' + ch] = osc;
    AudioState['awgGain' + ch] = gain;
}

/**
 * 动态更新信号发生器参数
 * @param {number} ch - 触发更新的通道编号 (1-8)
 * @param {number} freq - 目标频率
 */
export function updateAWG(ch, freq) {
    initAudio();
    rebuildChannel(ch);
}

/**
 * 将滑块数值映射为对数倍速 (0.001x - 2.0x)
 */
export function getLogSpeed(sliderVal) {
    const spd = 0.001 * Math.pow((2.0 / 0.001), sliderVal / 100); 
    // 加入死区：在 1.0 附近自动吸附，防止细微的手抖
    return (spd > 0.97 && spd < 1.03) ? 1.0 : spd;
}

/**
 * 计算当前音频文件准确的播放进度时间
 */
export function getCurrentTime() {
    if (!AudioState.isMusicPlaying || !AudioState.audioBuffer || !AudioState.bufferSource || AudioState.audioCtx.state !== 'running') {
        return AudioState.startOffset;
    }
    return (AudioState.startOffset + (AudioState.audioCtx.currentTime - AudioState.startTime) * AudioState.bufferSource.playbackRate.value) % AudioState.audioBuffer.duration;
}

/**
 * 带有进度回调的 Fetch 请求包装器 (主要用于加载远端音频文件)
 */
export function fetchWithProgress(url, onProgress) {
    return new Promise((resolve, reject) => {
        // 如果有正在进行的下载，先掐断
        if (AudioState.currentXHR) AudioState.currentXHR.abort();
        
        const xhr = new XMLHttpRequest(); 
        AudioState.currentXHR = xhr;
        xhr.open('GET', url); 
        xhr.responseType = 'arraybuffer';
        
        xhr.onprogress = (e) => { 
            if (e.lengthComputable) {
                onProgress(Math.floor((e.loaded / e.total) * 100)); 
            }
        };
        
        xhr.onload = () => { 
            AudioState.currentXHR = null; 
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response); 
            } else {
                reject(new Error("网络请求失败: HTTP " + xhr.status)); 
            }
        };
        
        xhr.onerror = () => { 
            AudioState.currentXHR = null; 
            reject(new Error("网络请求异常")); 
        };
        
        xhr.onabort = () => { 
            AudioState.currentXHR = null; 
            reject(new Error("ABORTED")); 
        };
        
        xhr.send();
    });
}

/**
 * 加载并播放音频文件 (支持远端 URL 或本地 File 对象)
 * @param {string|File} fileOrUrl - 音频数据源
 * @param {number} offset - 指定播放的起始时间点 (秒)
 */
export async function playBuffer(fileOrUrl, offset = 0) {
    initAudio();
    
    const overlay = document.getElementById('audio-loading-overlay');
    const progressBar = document.getElementById('audio-progress-bar');
    const loadingText = document.getElementById('audio-loading-text');

    try {
        // 如果传入了新的文件源，则进行解析
        if (fileOrUrl) {
            overlay.style.display = 'flex'; 
            DOM.btnAudioToggle.disabled = true;
            let arrayBuffer;
            
            if (typeof fileOrUrl === 'string') {
                arrayBuffer = await fetchWithProgress(fileOrUrl, (percent) => { 
                    progressBar.style.width = percent + '%'; 
                    loadingText.innerText = `下载中... ${percent}%`; 
                });
                loadingText.innerText = "解码音频中...";
            } else {
                if (AudioState.currentXHR) AudioState.currentXHR.abort();
                loadingText.innerText = "读取本地文件..."; 
                arrayBuffer = await fileOrUrl.arrayBuffer();
            }
            
            // WebAudio 原生解码器
            AudioState.audioBuffer = await AudioState.audioCtx.decodeAudioData(arrayBuffer);
        }
        
        if (!AudioState.audioBuffer) return;
        
        // 清理上一个播放节点
        if (AudioState.bufferSource) { 
            try { 
                AudioState.bufferSource.stop(); 
            } catch (e) { } 
            AudioState.bufferSource.disconnect(); 
        }
        
        // 创建新的播放节点
        AudioState.bufferSource = AudioState.audioCtx.createBufferSource();
        AudioState.bufferSource.buffer = AudioState.audioBuffer;
        AudioState.bufferSource.loop = true;
        AudioState.bufferSource.playbackRate.value = getLogSpeed(parseFloat(DOM.knobAudioSpeed.value));
        
        AudioState.startOffset = offset; 
        AudioState.startTime = AudioState.audioCtx.currentTime; 
        AudioState.isMusicPlaying = true;
        
        AudioState.bufferSource.connect(AudioState.musicGainNode);
        AudioState.bufferSource.start(0, offset % AudioState.audioBuffer.duration);
        
        if (AudioState.audioCtx.state === 'suspended') {
            await AudioState.audioCtx.resume();
        }
    } catch (err) {
        if (err.message !== "ABORTED") {
            showSysModal('加载失败', err.message); 
        } else {
            console.log("上一个下载任务已被主动掐断");
        }
    } finally {
        if (!AudioState.currentXHR) { 
            overlay.style.display = 'none'; 
            progressBar.style.width = '0%'; 
            DOM.btnAudioToggle.innerText = ' ⏸ '; 
            DOM.btnAudioToggle.disabled = false; 
        }
    }
}