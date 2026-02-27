import { CONFIG, DOM, showSysModal } from './core.js';

/**
 * ==========================================
 * 全局音频状态与节点管理器
 * ==========================================
 */
export const AudioState = {
    // 核心环境
    audioCtx: null, 
    splitter: null, 
    merger: null, 
    
    // 物理麦克风输入
    micSource: null, 
    micStream: null,
    
    // 音频播放节点
    fileSourceNode: null, 
    musicGainNode: null,
    
    // 内置信号发生器 (AWG) 节点
    awgOsc1: null, 
    awgGain1: null, 
    awgOsc2: null, 
    awgGain2: null, 
    awgSpeakerGain: null,
    
    // 示波器采集分析节点
    analyserL_DC: null, 
    analyserR_DC: null, 
    analyserL_AC: null, 
    analyserR_AC: null, 
    ch1Mixer: null, 
    ch2Mixer: null,
    
    // 音频播放状态与网络请求控制
    audioBuffer: null, 
    bufferSource: null, 
    startTime: 0, 
    startOffset: 0, 
    isSeeking: false, 
    isMusicPlaying: false, 
    currentXHR: null
};

/**
 * 初始化 WebAudio 环境及拓扑网络
 * 将所有音频源连接到对应的分析器 (Analyser) 与混音器 (Mixer)
 */
export function initAudio() {
    if (!AudioState.audioCtx) {
        // 创建音频上下文，为了更好的实时性，设置 latencyHint 为交互模式
        AudioState.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ 
            sampleRate: CONFIG.sampleRate, 
            latencyHint: 'interactive' 
        });
        
        // 初始化通道混音器
        AudioState.ch1Mixer = AudioState.audioCtx.createGain(); 
        AudioState.ch2Mixer = AudioState.audioCtx.createGain();
        
        // 初始化直流耦合 (DC) 分析器
        AudioState.analyserL_DC = AudioState.audioCtx.createAnalyser(); 
        AudioState.analyserL_DC.fftSize = CONFIG.fftSize;
        AudioState.analyserR_DC = AudioState.audioCtx.createAnalyser(); 
        AudioState.analyserR_DC.fftSize = CONFIG.fftSize;
        
        // 初始化交流耦合 (AC) 分析器
        AudioState.analyserL_AC = AudioState.audioCtx.createAnalyser(); 
        AudioState.analyserL_AC.fftSize = CONFIG.fftSize;
        AudioState.analyserR_AC = AudioState.audioCtx.createAnalyser(); 
        AudioState.analyserR_AC.fftSize = CONFIG.fftSize;
        
        // 创建 10Hz 高通滤波器，用于模拟 AC 耦合时的直流阻断
        let hpL = AudioState.audioCtx.createBiquadFilter(); 
        hpL.type = 'highpass'; 
        hpL.frequency.value = 10;
        
        let hpR = AudioState.audioCtx.createBiquadFilter(); 
        hpR.type = 'highpass'; 
        hpR.frequency.value = 10;
        
        // 构建通道拓扑连接 (Mixer -> DC Analyser & Highpass -> AC Analyser)
        AudioState.ch1Mixer.connect(AudioState.analyserL_DC); 
        AudioState.ch1Mixer.connect(hpL); 
        hpL.connect(AudioState.analyserL_AC);
        
        AudioState.ch2Mixer.connect(AudioState.analyserR_DC); 
        AudioState.ch2Mixer.connect(hpR); 
        hpR.connect(AudioState.analyserR_AC);
        
        // 注入极微弱的直流偏置，防止分析器在绝对静音时输出负无穷导致渲染崩溃
        window.dcBias1 = AudioState.audioCtx.createConstantSource(); 
        window.dcBias1.offset.value = 0.000001; 
        window.dcBias1.connect(AudioState.ch1Mixer); 
        window.dcBias1.start();
        
        window.dcBias2 = AudioState.audioCtx.createConstantSource(); 
        window.dcBias2.offset.value = 0.000001; 
        window.dcBias2.connect(AudioState.ch2Mixer); 
        window.dcBias2.start();
        
        // 创建分离器，用于解析立体声音频文件
        AudioState.splitter = AudioState.audioCtx.createChannelSplitter(2);
        AudioState.splitter.connect(AudioState.ch1Mixer, 0); 
        AudioState.splitter.connect(AudioState.ch2Mixer, 1);
        
        // 创建合并器，用于将生成的波形输出到物理扬声器
        AudioState.merger = AudioState.audioCtx.createChannelMerger(2);
        AudioState.awgSpeakerGain = AudioState.audioCtx.createGain(); 
        AudioState.awgSpeakerGain.gain.value = 0;
        AudioState.merger.connect(AudioState.awgSpeakerGain); 
        AudioState.awgSpeakerGain.connect(AudioState.audioCtx.destination);
        
        // 音频文件播放的主音量控制
        AudioState.musicGainNode = AudioState.audioCtx.createGain(); 
        AudioState.musicGainNode.gain.value = 1;
        AudioState.musicGainNode.connect(AudioState.splitter); 
        AudioState.musicGainNode.connect(AudioState.audioCtx.destination);
    }
}

/**
 * 重新构建指定通道的信号发生器 (AWG) 节点
 * @param {number} ch - 通道编号 (1 或 2)
 */
export function rebuildChannel(ch) {
    let type = DOM['genType' + ch].value;
    let target = ch === 1 ? AudioState.ch1Mixer : AudioState.ch2Mixer;
    
    // 清理旧的音频节点以释放内存
    if (ch === 1 && AudioState.awgOsc1) { 
        AudioState.awgOsc1.stop(); 
        AudioState.awgOsc1.disconnect(); 
        AudioState.awgOsc1 = null; 
        if (AudioState.awgGain1) { 
            AudioState.awgGain1.disconnect(); 
            AudioState.awgGain1 = null; 
        } 
    }
    
    if (ch === 2 && AudioState.awgOsc2) { 
        AudioState.awgOsc2.stop(); 
        AudioState.awgOsc2.disconnect(); 
        AudioState.awgOsc2 = null; 
        if (AudioState.awgGain2) { 
            AudioState.awgGain2.disconnect(); 
            AudioState.awgGain2 = null; 
        } 
    }
    
    // 如果选择为关闭，则直接退出
    if (type === 'off') return;
    
    // 读取最新的频率与振幅参数
    let freq = parseFloat(DOM['numGenFreq' + ch].value);
    let amp = parseFloat(DOM['knobGenAmp' + ch].value);
    
    let osc = AudioState.audioCtx.createOscillator();
    let gain = AudioState.audioCtx.createGain();
    
    gain.gain.value = amp; 
    osc.type = type; 
    osc.frequency.value = freq;
    
    // 连接到混音器(用于显示)与合并器(用于发声)
    osc.connect(gain); 
    gain.connect(target); 
    gain.connect(AudioState.merger, 0, ch === 1 ? 0 : 1);
    
    osc.start();
    
    // 保存引用
    if (ch === 1) { 
        AudioState.awgOsc1 = osc; 
        AudioState.awgGain1 = gain; 
    } else { 
        AudioState.awgOsc2 = osc; 
        AudioState.awgGain2 = gain; 
    }
}

/**
 * 动态更新信号发生器参数，并处理双通道锁相 (Phase Lock) 逻辑
 * 只有当双通道波形类型不同且频率极其相近时，才会触发严格的起步时间同步，以保证完美绘制 Lissajous (李萨如) 图形。
 * @param {number} ch - 触发更新的通道编号
 * @param {number} freq - 目标频率
 */
export function updateAWG(ch, freq) {
    initAudio();
    
    let otherCh = ch === 1 ? 2 : 1;
    let type = DOM['genType' + ch].value;
    let otherType = DOM['genType' + otherCh].value;
    let otherFreqElem = DOM['numGenFreq' + otherCh];
    let otherFreq = otherFreqElem ? parseFloat(otherFreqElem.value) : 0;
    
    // 判定是否满足锁相条件
    let lock = (type !== 'off' && otherType !== 'off' && Math.abs(freq - otherFreq) < 0.5);

    if (lock) {
        // 如果已经处于锁定状态且参数未变，避免重复创建节点
        if (window._lockActive && window._lockFreq === freq && window._lockType1 === type && window._lockType2 === otherType) {
            return;
        }
        
        // 销毁旧节点
        if (AudioState.awgOsc1) { AudioState.awgOsc1.stop(); AudioState.awgOsc1.disconnect(); AudioState.awgOsc1 = null; }
        if (AudioState.awgOsc2) { AudioState.awgOsc2.stop(); AudioState.awgOsc2.disconnect(); AudioState.awgOsc2 = null; }
        if (AudioState.awgGain1) { AudioState.awgGain1.disconnect(); AudioState.awgGain1 = null; }
        if (AudioState.awgGain2) { AudioState.awgGain2.disconnect(); AudioState.awgGain2 = null; }

        // 设定未来绝对同步起步时间
        let baseTime = AudioState.audioCtx.currentTime + 0.01;
        
        // 实例化 CH1
        let osc1 = AudioState.audioCtx.createOscillator(); 
        osc1.type = type; 
        osc1.frequency.value = freq;
        let gain1 = AudioState.audioCtx.createGain(); 
        gain1.gain.value = parseFloat(DOM.knobGenAmp1.value);
        osc1.connect(gain1); 
        gain1.connect(AudioState.ch1Mixer); 
        gain1.connect(AudioState.merger, 0, 0); 
        osc1.start(baseTime);
        AudioState.awgOsc1 = osc1; 
        AudioState.awgGain1 = gain1;

        // 实例化 CH2 (人为引入 90 度相位差，即 1/4 周期，以渲染完美的圆形李萨如)
        let osc2 = AudioState.audioCtx.createOscillator(); 
        osc2.type = otherType; 
        osc2.frequency.value = freq;
        let gain2 = AudioState.audioCtx.createGain(); 
        gain2.gain.value = parseFloat(DOM.knobGenAmp2.value);
        osc2.connect(gain2); 
        gain2.connect(AudioState.ch2Mixer); 
        gain2.connect(AudioState.merger, 0, 1); 
        osc2.start(baseTime + 0.25 / freq);
        AudioState.awgOsc2 = osc2; 
        AudioState.awgGain2 = gain2;

        window._lockActive = true; 
        window._lockFreq = freq; 
        window._lockType1 = type; 
        window._lockType2 = otherType; 
        
        return;
    }
    
    // 如果失去锁相条件，则拆除锁相机制，退回独立渲染
    if (window._lockActive) {
        if (AudioState.awgOsc1) { AudioState.awgOsc1.stop(); AudioState.awgOsc1.disconnect(); AudioState.awgOsc1 = null; }
        if (AudioState.awgOsc2) { AudioState.awgOsc2.stop(); AudioState.awgOsc2.disconnect(); AudioState.awgOsc2 = null; }
        if (AudioState.awgGain1) { AudioState.awgGain1.disconnect(); AudioState.awgGain1 = null; }
        if (AudioState.awgGain2) { AudioState.awgGain2.disconnect(); AudioState.awgGain2 = null; }
        
        window._lockActive = false; 
        rebuildChannel(1); 
        rebuildChannel(2); 
        
        return;
    }
    
    // 默认情况：独立重建
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