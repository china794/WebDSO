import { CONFIG, DOM, STATE, Buffers, showSysModal, CHANNEL_COUNT } from './core.js';
import { AudioState } from './audio.js';
import { FFT } from './lib/fft.js';

/**
 * ==========================================
 * 串口通信引擎 (Serial Engine)
 * 负责 Web Serial 通信、协议解析、系统模式切换及数据可听化
 * ==========================================
 */
export const SerialEngine = {
    // 基础串口状态
    port: null,
    reader: null,
    keepReading: false,
    
    // 协议解析缓冲
    rawBuffer: [],
    textBuffer: '',
    textDecoder: new TextDecoder(),
    
    // 示波器环形缓冲区 (用于渲染)
    ring1: new Float32Array(CONFIG.fftSize), ring2: new Float32Array(CONFIG.fftSize),
    ring3: new Float32Array(CONFIG.fftSize), ring4: new Float32Array(CONFIG.fftSize),
    ring5: new Float32Array(CONFIG.fftSize), ring6: new Float32Array(CONFIG.fftSize),
    ring7: new Float32Array(CONFIG.fftSize), ring8: new Float32Array(CONFIG.fftSize),
    head: 0,

    // 音频控制与缓冲变量 (数据可听化，取 CH1/CH2 用于立体声)
    audioAccumL: [],
    audioAccumR: [],
    audioNextTime: 0,
    masterGain: null, // 总音量阀门

    /**
     * 专门管理扬声器开关，实现瞬间丝滑静音
     * @param {boolean} isOn - 扬声器目标状态
     */
    toggleSpeaker: function(isOn) {
        STATE.serial.speaker = isOn;
        
        if (!isOn) {
            this.audioAccumL = [];
            this.audioAccumR = [];
        } else {
            this.audioNextTime = 0; // 重新打开时，重置时间轴
        }

        // 如果阀门已经建立，利用渐变实现 0.02秒丝滑静音，防止爆音
        if (this.masterGain && AudioState.audioCtx) {
            const now = AudioState.audioCtx.currentTime;
            this.masterGain.gain.setTargetAtTime(isOn ? 0.5 : 0, now, 0.02);
        }
    },

    /**
     * 动态量程切换中枢
     * 根据当前波特率自动调整时基 (SEC/DIV) 的范围与初始值
     * @param {boolean} isSerial - 是否处于串口模式
     */
    switchMode: function(isSerial) {
        const timebase = DOM.knobTimebase;
        
        if (isSerial) {
            const baud = parseInt(DOM.serialBaud.value);
            
            // 1. 计算理论采样率 (JustFloat: 10 bits/byte * 12 bytes/frame)
            const estimatedRate = Math.floor(baud / 120);
            
            STATE.current.isSerial = true;
            STATE.current.sampleRate = estimatedRate;
            STATE.current.lineSize = 0.002; 

            // 2. 动态计算时基范围 (ms/div)
            let minMs = (10 / estimatedRate) * 1000;
            if (minMs < 0.1) minMs = 0.1;

            let maxMs = (500 / estimatedRate) * 1000;
            if (maxMs < minMs * 10) maxMs = minMs * 10;

            // 3. 更新 HTML 滑块属性
            timebase.min = minMs.toFixed(2);
            timebase.max = maxMs.toFixed(1);
            timebase.step = (minMs < 1) ? "0.1" : "1";
            
            // 4. 设置默认初始值 (保证画面美观)
            let defaultVal = (50 / estimatedRate) * 1000;
            if (defaultVal < minMs) defaultVal = minMs;
            if (defaultVal > maxMs) defaultVal = maxMs;

            timebase.value = defaultVal.toFixed(2);
            STATE.secPerDiv = parseFloat(timebase.value);

            // 5. 同步显示 UI
            const txt = STATE.secPerDiv.toFixed(2) + "ms";
            DOM.lblTimebase.innerText = txt;
            if (DOM.osdTimebase) DOM.osdTimebase.innerText = txt;

        } else {
            // 🔙 回归音频模式 (降级为默认参数)
            STATE.current.isSerial = false;
            STATE.current.sampleRate = CONFIG.sampleRate;
            STATE.current.lineSize = 0.002;

            timebase.min = "1";
            timebase.max = "34";
            timebase.step = "1";
            timebase.value = "5";
            STATE.secPerDiv = 5;

            const txt = "5.0ms";
            DOM.lblTimebase.innerText = txt;
            if (DOM.osdTimebase) DOM.osdTimebase.innerText = txt;
        }
        
        // 触发 UI 更新事件
        timebase.dispatchEvent(new Event('input'));
        this.updateUI(isSerial);
    },

    /**
     * 连接 Web Serial 设备
     */
    connect: async function() {
        if (!('serial' in navigator)) {
            return showSysModal('环境不支持', '请使用基于 Chromium 内核的现代浏览器 (如 Chrome/Edge)');
        }
        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({ 
                baudRate: parseInt(DOM.serialBaud.value), 
                bufferSize: 8192 
            });
            
            this.keepReading = true;
            STATE.serial.connected = true;
            
            this.switchMode(true); 
            this.readLoop();
        } catch (e) { 
            showSysModal('连接失败', e.message); 
        }
    },

    /**
     * 断开 Web Serial 设备
     */
    disconnect: async function() {
        this.keepReading = false;
        if (this.reader) await this.reader.cancel();
        if (this.port) await this.port.close();
        
        STATE.serial.connected = false;
        this.switchMode(false); 
    },

    // ------------------------------------------
    // 数据解析器 (Parsers)
    // ------------------------------------------

    /**
     * 数据解析入口路由
     * @param {Uint8Array} data - 从串口读取的原始二进制数据
     */
    parseData: function(data) { 
        DOM.serialProtocol.value === 'justfloat' ? this.parseJustFloat(data) : this.parseFireWater(data); 
    },
    
    /**
     * JustFloat 二进制协议解析 (高性能)
     */
    parseJustFloat: function(data) {
        for (let i = 0; i < data.length; i++) {
            this.rawBuffer.push(data[i]);
        }
        
        while (this.rawBuffer.length >= 12) {
            let s1 = this.findSync(0); 
            if (s1 === -1) { 
                this.rawBuffer = []; 
                break; 
            }
            
            let s2 = this.findSync(s1 + 4); 
            if (s2 === -1) break;
            
            const payload = this.rawBuffer.slice(s1 + 4, s2);
            if (payload.length > 0 && payload.length % 4 === 0) {
                this.pushToRings(this.bytesToFloats(payload));
            }
            this.rawBuffer = this.rawBuffer.slice(s2);
        }
    },

    /**
     * FireWater 纯文本协议解析 (兼容模式)
     */
    parseFireWater: function(data) {
        this.textBuffer += this.textDecoder.decode(data, { stream: true });
        let lines = this.textBuffer.split(/\r?\n/); 
        this.textBuffer = lines.pop(); // 保留最后一行未闭合的残段
        
        for (let l of lines) {
            let s = l.trim(); 
            if (!s) continue; 
            
            if (s.includes(':')) s = s.split(':')[1];
            const v = s.split(',').map(p => parseFloat(p)).filter(n => !isNaN(n));
            
            if (v.length > 0) this.pushToRings(v);
        }
    },

    /**
     * 寻找 JustFloat 同步字
     * 目标序列: 00 00 80 7F
     */
    findSync: function(st) { 
        for (let i = st; i <= this.rawBuffer.length - 4; i++) { 
            if (this.rawBuffer[i] === 0x00 && 
                this.rawBuffer[i+1] === 0x00 && 
                this.rawBuffer[i+2] === 0x80 && 
                this.rawBuffer[i+3] === 0x7F) {
                return i;
            }
        } 
        return -1; 
    },

    /**
     * 字节数组转为 IEEE-754 单精度浮点数
     */
    bytesToFloats: function(b) { 
        const v = new DataView(new Uint8Array(b).buffer); 
        const f = []; 
        for (let i = 0; i < b.length; i += 4) {
            f.push(v.getFloat32(i, true)); // true 为小端序
        }
        return f; 
    },

    // ------------------------------------------
    // 渲染缓冲与音频调度核心
    // ------------------------------------------

    /**
     * 核心数据推入函数 (同时处理渲染环与音频分流)
     * @param {Array<number>} v - 提取出的浮点数据数组
     */
    pushToRings: function(v) { 
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            this['ring' + i][this.head] = v[i - 1] ?? v[0] ?? 0;
        }
        this.head = (this.head + 1) % CONFIG.fftSize; 
        
        // 2. 声音监听钩子 (使用 serialOutL/serialOutR 选择通道用于立体声)
        if (STATE.serial && STATE.serial.speaker) {
            const currentRate = STATE.current.sampleRate || 16000;
            const repeat = currentRate < 8000 ? Math.ceil(8000 / currentRate) : 1;
            const leftCh = (STATE.serialOutL || 1) - 1;
            const rightCh = (STATE.serialOutR || 2) - 1;
            const v1 = v[leftCh] ?? 0;
            const v2 = v[rightCh] ?? v1;
            for(let i = 0; i < repeat; i++) {
                this.audioAccumL.push(v1);
                this.audioAccumR.push(v2);
            }
            
            // 积攒到足够切片 (2048) 后，交付声卡物理调度
            if (this.audioAccumL.length >= 2048) {
                this.playAudioChunk(currentRate * repeat);
            }
        }
    },

    /**
     * 音频流物理调度器 (附带高级防积压算法)
     * @param {number} playRate - 最终发送给声卡的采样率
     */
    playAudioChunk: function(playRate) {
        if (!AudioState.audioCtx || AudioState.audioCtx.state !== 'running') return;
        
        const ctx = AudioState.audioCtx;

        // 初始化主音量限制阀门
        if (!this.masterGain) {
            this.masterGain = ctx.createGain();
            this.masterGain.gain.value = 0.5; // 限制全局最大物理音量
            this.masterGain.connect(ctx.destination);
        }

        // 限制 WebAudio 允许的采样率区间
        const sr = Math.max(8000, Math.min(96000, playRate)); 
        const len = this.audioAccumL.length;
        
        const buffer = ctx.createBuffer(2, len, sr);
        buffer.copyToChannel(new Float32Array(this.audioAccumL), 0);
        buffer.copyToChannel(new Float32Array(this.audioAccumR), 1);
        
        // 释放原数组，重置缓冲池
        this.audioAccumL = [];
        this.audioAccumR = [];
        
        const now = ctx.currentTime;
        
        // 核心防积压 (Anti-Drift) 机制
        if (this.audioNextTime < now) {
            // 时间轴落后 (发生卡顿)，强制后延 0.05 秒重新对齐
            this.audioNextTime = now + 0.05; 
        } else if (this.audioNextTime > now + 0.4) {
            // 调度时间严重超前 (JS 处理速度 > 播放速度)，直接丢弃此切片以强制泄洪
            return; 
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.masterGain); 
        
        source.start(this.audioNextTime);
        this.audioNextTime += buffer.duration;
    },

    /**
     * 将环形缓冲区的数据解包到线性渲染数组 (8 通道)
     */
    fillData: function(out1, out2, out3, out4, out5, out6, out7, out8) { 
        const outs = [out1, out2, out3, out4, out5, out6, out7, out8];
        for (let i = 0; i < CONFIG.fftSize; i++) { 
            let idx = (this.head - CONFIG.fftSize + i + CONFIG.fftSize) % CONFIG.fftSize; 
            for (let ch = 0; ch < CHANNEL_COUNT && outs[ch]; ch++) {
                outs[ch][i] = this['ring' + (ch + 1)][idx];
            }
        } 
    },

    /**
     * 更新串口状态 UI
     */
    updateUI: function(c) {
        DOM.serialStatusDot.innerText = c ? '● CONNECTED' : '● DISCONNECTED';
        DOM.serialStatusDot.style.color = c ? '#4ade80' : '#ef4444'; 
        DOM.btnSerialOpen.style.display = c ? 'none' : 'block';
        DOM.btnSerialClose.style.display = c ? 'block' : 'none';
    },

    /**
     * 后台无尽读取循环
     */
    async readLoop() {
        while (this.keepReading && this.port.readable) {
            this.reader = this.port.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    this.parseData(value);
                }
            } catch (e) { 
                console.warn("Serial read error:", e); 
            } finally { 
                this.reader.releaseLock(); 
            }
        }
    }
};