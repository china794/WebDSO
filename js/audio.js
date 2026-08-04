import { CONFIG, DOM, showSysModal, CHANNEL_COUNT, STATE } from './core.js';
import { SYSTEM, AUDIO, GENERATOR } from './constants.js';

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
    isSeeking: false, isMusicPlaying: false, currentXHR: null,

    // ---- <audio> 流式降级播放 ----
    audioElement: null,      // <audio> 元素引用（index.html #audio-player）
    mediaSourceNode: null,   // MediaElementAudioSourceNode（降级路由到 analyser）
    streamingMode: false,    // 是否降级模式（decodeAudioData 失败时）
    streamingURL: null,      // 当前 objectURL / 远程 URL（用于 revoke）
};

/**
 * 初始化 WebAudio 环境及拓扑网络
 * 将所有音频源连接到对应的分析器 (Analyser) 与混音器 (Mixer)
 */
export function initAudio() {
    if (!AudioState.audioCtx) {
        try {
            AudioState.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ 
                sampleRate: CONFIG.sampleRate, latencyHint: 'interactive' 
            });
        } catch (e) {
            console.warn('WebDSO: AudioContext 创建失败:', e.message);
            return;
        }
        
        AudioState.panMaster = AudioState.audioCtx.createGain();
        // 默认静音：splitter→chN Mixer→Panner 这条全局路径会强制把
        // 麦克风/文件/串口信号送进扬声器，导致声反馈回声。
        // 文件播放走 musicGainNode→destination 独立出声，不受此影响；
        // 需要监听输入时由 btn-awg-spk 显式开启。
        AudioState.panMaster.gain.value = 0;
        AudioState.panMaster.connect(AudioState.audioCtx.destination);

        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            AudioState['ch' + i + 'Mixer'] = AudioState.audioCtx.createGain();
            AudioState['analyser' + i + '_DC'] = AudioState.audioCtx.createAnalyser();
            AudioState['analyser' + i + '_DC'].fftSize = CONFIG.fftSize;
            AudioState['analyser' + i + '_AC'] = AudioState.audioCtx.createAnalyser();
            AudioState['analyser' + i + '_AC'].fftSize = CONFIG.fftSize;
            
            const hp = AudioState.audioCtx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = AUDIO.HIGHPASS_FREQ;
            AudioState['ch' + i + 'Mixer'].connect(AudioState['analyser' + i + '_DC']);
            AudioState['ch' + i + 'Mixer'].connect(hp);
            hp.connect(AudioState['analyser' + i + '_AC']);
            
            // 每个通道独立的声像控制器
            AudioState['ch' + i + 'Panner'] = AudioState.audioCtx.createStereoPanner();
            AudioState['ch' + i + 'Panner'].pan.value = 0;
            AudioState['ch' + i + 'Mixer'].connect(AudioState['ch' + i + 'Panner']);
            AudioState['ch' + i + 'Panner'].connect(AudioState.panMaster);
            
            const bias = AudioState.audioCtx.createConstantSource();
            bias.offset.value = AUDIO.DC_BIAS;
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
        // 用 STATE.awgMonitor 同步初始化增益：按钮默认「扬声器关」时，AWG 监听路径也必须静音。
        // 此前硬编码 0.5 导致按钮显示关闭、发生器却仍出声的不一致。
        AudioState.awgSpeakerGain.gain.value = STATE.awgMonitor ? 1.0 : 0;
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

/**
 * 根据当前激活的频道数自动分配声像：从 L(-1) 到 R(+1) 均匀分布
 * 例如：2个频道 → CH1:-1(左) CH2:+1(右)
 *       3个频道 → CH1:-1(左) CH2:0(中) CH3:+1(右)
 */
export function updateAutoPan() {
    if (!AudioState.audioCtx) return;
    // 收集激活频道
    const activeChs = [];
    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        if (STATE['ch' + i]?.on && AudioState['ch' + i + 'Panner']) {
            activeChs.push(i);
        }
    }
    const count = activeChs.length;
    if (count === 0) return;
    for (let idx = 0; idx < count; idx++) {
        const ch = activeChs[idx];
        // count=1 → 0(中); count=2 → -1,+1; count=3 → -1,0,+1; count=8 → -1,-0.71,-0.43,...,+1
        const pan = count === 1 ? 0 : -1 + (2 * idx) / (count - 1);
        AudioState['ch' + ch + 'Panner'].pan.value = Math.max(-1, Math.min(1, pan));
    }
}
window.__updateAutoPan = updateAutoPan;

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
/**
 * 生成自定义音频缓冲区（用于 noise/pwm/chirp/am/fm/dual）
 */
function createCustomWaveBuffer(type, chState, sr) {
    const amp = chState.genAmp ?? 0.5;
    const freq = chState.genFreq ?? 1000;
    const dur = 2;
    const len = sr * dur;
    const buf = new Float32Array(len);

    switch (type) {
        case 'noise':
            for (let i = 0; i < len; i++) buf[i] = (Math.random() * 2 - 1) * amp;
            break;
        case 'pwm': {
            const duty = (chState.genDuty ?? 50) / 100;
            const period = sr / freq;
            for (let i = 0; i < len; i++) buf[i] = ((i % period) / period < duty ? 1 : -1) * amp;
            break;
        }
        case 'chirp': {
            const fEnd = chState.genFreqEnd ?? 5000;
            const swT = Math.min(dur, chState.genSweepTime ?? 1);
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                const frac = Math.min(t / swT, 1);
                const fi = freq + (fEnd - freq) * frac;
                const phase = 2 * Math.PI * (freq * t + (fEnd - freq) * t * t / (2 * swT));
                buf[i] = Math.sin(phase) * amp * (t < swT ? 1 : 0);
            }
            break;
        }
        case 'am': {
            const mf = chState.genModFreq ?? 10;
            const md = (chState.genModDepth ?? 50) / 100;
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                buf[i] = Math.sin(2 * Math.PI * freq * t) * (1 + md * Math.sin(2 * Math.PI * mf * t)) * amp * 0.5;
            }
            break;
        }
        case 'fm': {
            const mf2 = chState.genModFreq ?? 10;
            const md2 = (chState.genModDepth ?? 50) / 100;
            const dev = freq * md2;
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                const phase = 2 * Math.PI * freq * t + (dev / mf2) * Math.sin(2 * Math.PI * mf2 * t);
                buf[i] = Math.sin(phase) * amp;
            }
            break;
        }

    }
    return buf;
}

/**
 * 重新构建指定通道的信号发生器 (AWG) 节点
 * 支持 OscillatorNode (sine/square/triangle/sawtooth) 和 AudioBufferSourceNode (自定义波形)
 */
export function rebuildChannel(ch) {
    // 确保 AudioContext 已创建且处于运行状态
    if (!AudioState.audioCtx) {
        initAudio();
        if (!AudioState.audioCtx) return;
    }
    if (AudioState.audioCtx.state === 'suspended') {
        AudioState.audioCtx.resume();
    }
    const chState = STATE['ch' + ch];
    if (!chState) return;
    let type = chState.genType || 'off';
    let target = AudioState['ch' + ch + 'Mixer'];

    const oldOsc = AudioState['awgOsc' + ch], oldGain = AudioState['awgGain' + ch];
    // stop() 对已停止的节点只能调用一次，第二次抛 InvalidStateError。
    // 快速调频/切波时旧节点可能已被 stop，这里包 try/catch 兜底。
    if (oldOsc) {
        try { oldOsc.stop(); } catch (e) { /* 已停止，忽略 */ }
        try { oldOsc.disconnect(); } catch (e) { /* 忽略 */ }
        AudioState['awgOsc' + ch] = null;
    }
    if (oldGain) {
        try { oldGain.disconnect(); } catch (e) { /* 忽略 */ }
        AudioState['awgGain' + ch] = null;
    }

    if (type === 'off' || !AudioState.audioCtx) return;

    let amp = chState.genAmp ?? 0.5;
    let freq = chState.genFreq ?? 1000;
    let gain = AudioState.audioCtx.createGain();
    gain.gain.value = amp;

    const isNative = ['sine', 'square', 'triangle', 'sawtooth'].includes(type);

    if (isNative && (type !== 'square' || !chState.genDuty || chState.genDuty === 50)) {
        let osc = AudioState.audioCtx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(target);
        gain.connect(AudioState.merger, 0, ch - 1);
        osc.start();
        AudioState['awgOsc' + ch] = osc;
        AudioState['awgGain' + ch] = gain;
    } else {
        const sr = AudioState.audioCtx.sampleRate;
        const data = createCustomWaveBuffer(type, chState, sr);
        if (!data) return;
        const buf = AudioState.audioCtx.createBuffer(1, data.length, sr);
        buf.getChannelData(0).set(data);
        const src = AudioState.audioCtx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        gain.gain.value = 1;
        src.connect(gain);
        gain.connect(target);
        gain.connect(AudioState.merger, 0, ch - 1);
        src.start();
        AudioState['awgOsc' + ch] = src;
        AudioState['awgGain' + ch] = gain;
    }
}

export function updateAWG(ch, freq) {
    initAudio();
    rebuildChannel(ch);
}

/**
 * 将滑块数值映射为对数倍速 (0.001x - 2.0x)
 */
export function getLogSpeed(sliderVal) {
    const spd = AUDIO.MIN_SPEED * Math.pow((AUDIO.MAX_SPEED / AUDIO.MIN_SPEED), sliderVal / AUDIO.SPEED_SLIDER_NORM); 
    // 加入死区：在 1.0 附近自动吸附，防止细微的手抖
    return (spd > AUDIO.SPEED_DEADZONE_LOW && spd < AUDIO.SPEED_DEADZONE_HIGH) ? AUDIO.NORMAL_SPEED : spd;
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
            let objectURL = null;

            if (typeof fileOrUrl === 'string') {
                // 远程 URL：下载后先尝试 decode，失败降级到远程 URL 或 blob
                arrayBuffer = await fetchWithProgress(fileOrUrl, (percent) => {
                    progressBar.style.width = percent + '%';
                    loadingText.innerText = `下载中... ${percent}%`;
                });
                loadingText.innerText = "解码音频中...";
                try {
                    // 复制一份供解码，避免 decodeAudioData 失败时 detach 原始数据
                    const decodeBuf = arrayBuffer.slice(0);
                    AudioState.audioBuffer = await AudioState.audioCtx.decodeAudioData(decodeBuf);
                } catch (decodeErr) {
                    console.warn('decodeAudioData 失败，降级到 <audio> 流式播放:', decodeErr.message);
                    // 远程：直接用 blob（保留已下载数据）或远程 URL
                    const blob = new Blob([arrayBuffer.slice(0)]);
                    objectURL = URL.createObjectURL(blob);
                    playViaStream(objectURL, offset);
                    AudioState.streamingURL = objectURL;
                    return;  // 降级路径完成，由 finally 清理 UI
                }
            } else {
                // 本地 File：先尝试 decode，失败降级直接用 File（Blob）
                if (AudioState.currentXHR) AudioState.currentXHR.abort();
                loadingText.innerText = "读取本地文件...";
                arrayBuffer = await fileOrUrl.arrayBuffer();
                try {
                    AudioState.audioBuffer = await AudioState.audioCtx.decodeAudioData(arrayBuffer);
                } catch (decodeErr) {
                    console.warn('decodeAudioData 失败，降级到 <audio> 流式播放:', decodeErr.message);
                    // 本地：直接用 File 对象（File 继承 Blob），无需重新读 buffer
                    objectURL = URL.createObjectURL(fileOrUrl);
                    playViaStream(objectURL, offset);
                    AudioState.streamingURL = objectURL;
                    return;  // 降级路径完成，由 finally 清理 UI
                }
            }
        }

        if (!AudioState.audioBuffer) return;

        // 清理上一个播放节点
        if (AudioState.bufferSource) {
            try {
                AudioState.bufferSource.stop();
            } catch (e) { }
            try {
                AudioState.bufferSource.disconnect();
            } catch (e) { }
            AudioState.bufferSource = null;
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

        if (AudioState.audioCtx?.state === 'suspended') {
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

/**
 * 降级播放：用 <audio> 元素流式播放（decodeAudioData 失败时）。
 * 浏览器原生流式解码，无 decodeAudioData 的内存限制。
 * 通过 MediaElementAudioSourceNode 路由到 analyser 显示波形。
 * @param {string} src - 音频 URL（objectURL 或远程 URL）
 * @param {number} offset - 起始时间（秒）
 */
function playViaStream(src, offset = 0) {
    // 获取 <audio> 元素（index.html #audio-player）
    const audio = DOM.audioPlayer || document.getElementById('audio-player');
    if (!audio) {
        showSysModal('播放失败', 'audio 元素不可用');
        return;
    }
    AudioState.audioElement = audio;

    // 清理上一次降级路由
    if (AudioState.mediaSourceNode) {
        try { AudioState.mediaSourceNode.disconnect(); } catch (e) {}
        AudioState.mediaSourceNode = null;
    }

    // 停止上一个 BufferSource（若在播）
    if (AudioState.bufferSource) {
        try { AudioState.bufferSource.stop(); } catch (e) {}
        try { AudioState.bufferSource.disconnect(); } catch (e) {}
        AudioState.bufferSource = null;
    }

    // 释放上一个 objectURL
    if (AudioState.streamingURL && AudioState.streamingURL.startsWith('blob:')) {
        URL.revokeObjectURL(AudioState.streamingURL);
    }
    AudioState.streamingURL = null;

    // 设置源并播放
    audio.src = src;
    audio.loop = true;
    // <audio> 元素 playbackRate 支持范围约 [0.0625, 16]，钳制变速值
    const speed = Math.max(0.0625, Math.min(16, getLogSpeed(parseFloat(DOM.knobAudioSpeed?.value || 90.9))));
    audio.playbackRate = speed;
    if (offset > 0) audio.currentTime = offset;

    // 路由到 analyser：MediaElementAudioSourceNode → splitter（各通道 mixer）
    if (AudioState.audioCtx) {
        try {
            const sourceNode = AudioState.audioCtx.createMediaElementSource(audio);
            sourceNode.connect(AudioState.splitter);
            AudioState.mediaSourceNode = sourceNode;
        } catch (e) {
            console.warn('MediaElementAudioSource 连接失败（audio 元素已被占用）:', e.message);
        }
    }

    // 播放
    const playPromise = audio.play();
    if (playPromise) {
        playPromise.catch((err) => {
            console.warn('audio.play() 失败:', err.message);
        });
    }

    // 状态
    AudioState.streamingMode = true;
    AudioState.isMusicPlaying = true;
    AudioState.audioBuffer = null;
    AudioState.startOffset = offset;
    AudioState.startTime = AudioState.audioCtx ? AudioState.audioCtx.currentTime : 0;

    if (AudioState.audioCtx && AudioState.audioCtx.state === 'suspended') {
        AudioState.audioCtx.resume();
    }
}

/**
 * 获取当前播放时间（兼容 decodeAudioData 与 <audio> 流式两种模式）。
 */
export function getCurrentTime() {
    if (AudioState.streamingMode && AudioState.audioElement) {
        return AudioState.audioElement.currentTime || 0;
    }
    if (!AudioState.isMusicPlaying || !AudioState.audioBuffer || !AudioState.bufferSource || !AudioState.audioCtx || AudioState.audioCtx.state !== 'running') {
        return AudioState.startOffset;
    }
    return (AudioState.startOffset + (AudioState.audioCtx.currentTime - AudioState.startTime) * AudioState.bufferSource.playbackRate.value) % AudioState.audioBuffer.duration;
}