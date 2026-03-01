import { CONFIG, DOM, STATE, Buffers, showSysModal, CHANNEL_COUNT, getMaxFreqForCurrentMode } from './core.js';
import { AudioState } from './audio.js';
import { SYSTEM, BUFFER, SERIAL, AUDIO, SERIAL_EXT } from './constants.js';

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

    // 协议解析缓冲 (极速线性内存版)
    linearBuffer: new Uint8Array(0), 
    textBuffer: '',
    textDecoder: new TextDecoder(),
    
    // 示波器环形缓冲区 (用于渲染) - 串口模式使用独立的大缓冲区
    ring1: new Float32Array(BUFFER.SERIAL_FFT_SIZE), ring2: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring3: new Float32Array(BUFFER.SERIAL_FFT_SIZE), ring4: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring5: new Float32Array(BUFFER.SERIAL_FFT_SIZE), ring6: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring7: new Float32Array(BUFFER.SERIAL_FFT_SIZE), ring8: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    head: 0,
    ringSize: BUFFER.SERIAL_FFT_SIZE, // 串口缓冲区大小

    // 用于fillData的缓存优化
    _lastReadIdx: -1,
    _lastHead: -1,

    // 音频控制与缓冲变量 (数据可听化，取 CH1/CH2 用于立体声)
    audioAccumL: [],
    audioAccumR: [],
    audioNextTime: 0,
    audioPhase: 0,        // [新增] 相位累加器，用于完美重采样
    _dcX_L: 0, _dcY_L: 0, // [新增] 左声道 DC Blocker 状态
    _dcX_R: 0, _dcY_R: 0, // [新增] 右声道 DC Blocker 状态
    masterGain: null,

    /**
     * 专门管理扬声器开关，实现瞬间丝滑静音
     */
    toggleSpeaker: function(isOn) {
        STATE.serial.speaker = isOn;
        
        if (!isOn) {
            this.audioAccumL = [];
            this.audioAccumR = [];
            this.audioPhase = 0;
            this._dcX_L = 0; this._dcY_L = 0;
            this._dcX_R = 0; this._dcY_R = 0;
        } else {
            this.audioNextTime = 0;
        }

        if (this.masterGain && AudioState.audioCtx) {
            const now = AudioState.audioCtx.currentTime;
            this.masterGain.gain.setTargetAtTime(isOn ? 0.5 : 0, now, 0.02);
        }
    },

    /**
     * 动态量程切换中枢
     */
    switchMode: function(isSerial) {
        const timebase = DOM.knobTimebase;
        
        if (isSerial) {
            const baud = parseInt(DOM.serialBaud.value);
            
            // 1. 计算理论采样率
            const isHighSpeed = baud > 1000000;
            const bytesPerFrame = isHighSpeed ? 7 : SERIAL.BYTES_PER_FRAME; 
            const estimatedRate = Math.floor(baud / bytesPerFrame);
            
            STATE.current.isSerial = true;
            STATE.current.sampleRate = estimatedRate;
            STATE.current.lineSize = 0.002;
            STATE.current.isHighSpeed = isHighSpeed; 

            // 2. 动态计算时基范围 (ms/div)
            // 最小值固定为0.1ms
            let minMs = 0.1;
            
            // 最大值：整个缓冲区大小对应的时间（10格）
            // SERIAL_FFT_SIZE 点 / 采样率 = 总时间（秒），除以10格 = ms/div
            let maxMs = (BUFFER.SERIAL_FFT_SIZE / estimatedRate) * 1000 / 10;
            // 限制最大值为10000ms（10秒/格），避免滑块范围过大
            if (maxMs > 10000) maxMs = 10000;
            // 确保最小值不超过最大值
            if (maxMs < minMs * 10) maxMs = minMs * 10;

            // 3. 保存当前模式的时基范围到STATE，供事件处理器使用
            STATE.current.timebaseMin = minMs;
            STATE.current.timebaseMax = maxMs;

            // 4. 更新 HTML 滑块属性 - 摇杆模式
            // 滑块范围-50到50，中间为0
            timebase.min = "-50";
            timebase.max = "50";
            timebase.step = "0.01";
            
            // 5. 设置默认初始值（滑块中间位置）
            timebase.value = "0";
            
            // 设置默认时基值（不通过滑块计算，直接使用默认值）
            const defaultSecPerDiv = 1.0; // 默认1ms
            STATE.secPerDiv = defaultSecPerDiv;

            // 6. 同步显示 UI
            let txt;
            if (defaultSecPerDiv >= 1000) {
                txt = (defaultSecPerDiv / 1000).toFixed(2) + "s";
            } else {
                txt = defaultSecPerDiv.toFixed(2) + "ms";
            }
            DOM.lblTimebase.innerText = txt;

        } else {
            // 回归音频模式
            STATE.current.isSerial = false;
            STATE.current.sampleRate = CONFIG.sampleRate;
            STATE.current.lineSize = 0.002;

            // 音频模式 - 摇杆模式
            timebase.min = "-50";
            timebase.max = "50";
            timebase.step = "0.01";
            timebase.value = "0";
            
            // 设置默认时基值
            const defaultSecPerDiv = 1.0; // 默认1ms
            STATE.secPerDiv = defaultSecPerDiv;
            
            // 计算时基范围（供边缘检测使用）
            const minMs = 0.1;
            let maxMs = (BUFFER.FFT_SIZE / CONFIG.sampleRate) * 1000 / 10;
            if (maxMs > 500) maxMs = 500;
            if (maxMs < minMs * 10) maxMs = minMs * 10;
            
            // 保存音频模式的时基范围
            STATE.current.timebaseMin = minMs;
            STATE.current.timebaseMax = maxMs;

            let txt;
            if (defaultSecPerDiv >= 1000) {
                txt = (defaultSecPerDiv / 1000).toFixed(2) + "s";
            } else {
                txt = defaultSecPerDiv.toFixed(2) + "ms";
            }
            DOM.lblTimebase.innerText = txt;

            // 重置通道位置和scale为音频模式的默认值
            this.resetChannelsToDefault();

            // 更新FFT频率范围以匹配音频模式的采样率
            this.updateFftFreqRange();
        }

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
            const baudRate = parseInt(DOM.serialBaud.value);
            await this.port.open({ 
                baudRate: baudRate, 
                bufferSize: BUFFER.SERIAL_BUFFER 
            });
            
            this.keepReading = true;
            STATE.serial.connected = true;
            STATE.serial.baud = baudRate; 
            
            this.switchMode(true);
            this.readLoop();

            // 更新FFT频率范围以匹配新的采样率
            this.updateFftFreqRange();
        } catch (e) {
            showSysModal('连接失败', e.message);
        }
    },

    /**
     * 断开 Web Serial 设备
     */
    disconnect: async function() {
        this.keepReading = false;
        
        try {
            if (this.reader) {
                await this.reader.cancel().catch(() => {});
                this.reader = null;
            }
        } catch (e) {}
        
        try {
            if (this.port) {
                await this.port.close().catch(() => {});
                this.port = null;
            }
        } catch (e) {}
        
        STATE.serial.connected = false;
        STATE.serial.baud = SERIAL.DEFAULT_BAUD;
        
        // 清除所有通道的波形数据，防止串口关闭后波形仍然显示
        this.clearAllRings();
        
        this.switchMode(false); 
    },

    /**
     * 清除所有通道的环形缓冲区数据
     */
    clearAllRings: function() {
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            this['ring' + i].fill(0);
            // 同时清除Buffers中的数据
            Buffers['data' + i].fill(0);
            Buffers['pData' + i].fill(0);
        }
        this.head = 0;
        this.linearBuffer = new Uint8Array(0);
        this.rawBuffer = [];
    },

    // ------------------------------------------
    // 数据解析器 (Parsers)
    // ------------------------------------------

    parseData: function(data) { 
        DOM.serialProtocol.value === 'justfloat' ? this.parseJustFloat(data) : this.parseFireWater(data); 
    },
    
    /**
     * JustFloat 二进制协议解析 (极速线性内存版，彻底告别假死)
     */
    parseJustFloat: function(data) {
        // 1. 高效拼接二进制数据 (原生底层内存拷贝)
        const newBuffer = new Uint8Array(this.linearBuffer.length + data.length);
        newBuffer.set(this.linearBuffer, 0);
        newBuffer.set(data, this.linearBuffer.length);
        this.linearBuffer = newBuffer;

        // 防止异常情况下内存爆炸
        if (this.linearBuffer.length > 1048576) {
            this.linearBuffer = this.linearBuffer.slice(-1048576);
        }

        let offset = 0;
        // 至少要有 8 字节 (1个同步头 + 1个float) 才可能构成一帧
        while (offset + 8 <= this.linearBuffer.length) {
            // 找同步头 00 00 80 7F
            let s1 = this.findSyncInArray(this.linearBuffer, offset);
            
            if (s1 === -1) {
                // 没找到，说明剩下的全没用，标记丢弃
                offset = this.linearBuffer.length;
                break;
            }

            if (s1 > offset) {
                // 同步头不在游标处，跳过前面的垃圾数据
                offset = s1;
                continue;
            }

            // s1 === offset，说明现在刚好在帧头，寻找下一个同步头找帧尾
            let s2 = this.findSyncInArray(this.linearBuffer, offset + 4);
            
            if (s2 === -1) {
                // 还没收到下一帧的头，数据在途中被截断，等待下波数据
                break;
            }

            const payloadLength = s2 - (offset + 4);
            // 确保数据长度有效且是 float(4字节) 的整数倍
            if (payloadLength > 0 && payloadLength % 4 === 0) {
                const payload = this.linearBuffer.slice(offset + 4, s2);
                const samples = this.bytesToFloats(payload);
                this.pushToRings(samples);

                // 真实采样率打点记录 
                if (STATE.realSampleMeasurer) {
                    STATE.realSampleMeasurer.frameCount += 1;
                }
            }

            // 游标前进到下一个同步头，准备解析下一帧
            offset = s2;
        }

        // 截取未处理完的残端数据留给下次
        if (offset < this.linearBuffer.length) {
            this.linearBuffer = this.linearBuffer.slice(offset);
        } else {
            this.linearBuffer = new Uint8Array(0);
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
     * 寻找 JustFloat 同步字 (在数组中)
     * 目标序列: 00 00 80 7F
     */
    findSyncInArray: function(buffer, start) { 
        for (let i = start; i <= buffer.length - 4; i++) { 
            if (buffer[i] === 0x00 && 
                buffer[i+1] === 0x00 && 
                buffer[i+2] === 0x80 && 
                buffer[i+3] === 0x7F) {
                return i;
            }
        } 
        return -1; 
    },

    /**
     * 字节数组转为 IEEE-754 单精度浮点数
     */
    bytesToFloats: function(b) { 
        try {
            const v = new DataView(b.buffer, b.byteOffset, b.byteLength); 
            const f = []; 
            for (let i = 0; i < b.length; i += 4) {
                if (i + 4 <= b.length) {
                    f.push(v.getFloat32(i, true)); // true 为小端序
                }
            }
            return f; 
        } catch (error) {
            return [];
        }
    },

    // ------------------------------------------
    // 渲染缓冲与音频调度核心
    // ------------------------------------------

    /**
     * 核心数据推入函数
     */
    pushToRings: function(v) { 
        for (let i = 1; i <= CHANNEL_COUNT; i++) { 
            // 严格区分：没收到的通道绝不复制，直接硬塞 0，保证画面干净
            this['ring' + i][this.head] = v[i - 1] !== undefined ? v[i - 1] : 0; 
        } 
        this.head = (this.head + 1) % this.ringSize; 
        
        // 声音监听钩子
        if (STATE.serial && STATE.serial.speaker) {
            const currentRate = STATE.current.sampleRate || 16000;
            const leftCh = (STATE.serialOutL || 1) - 1;
            const rightCh = (STATE.serialOutR || 2) - 1;
            
            const v1 = v[leftCh] !== undefined ? v[leftCh] : 0;  
            const v2 = v[rightCh] !== undefined ? v[rightCh] : v1;  
            
            // 1. DC Blocker (一阶高通滤波)：滤除 0-3.3V 的直流偏置，转换为纯交流声
            const R = 0.995;
            const dcY_L = v1 - this._dcX_L + R * this._dcY_L;
            this._dcX_L = v1;
            this._dcY_L = dcY_L;

            const dcY_R = v2 - this._dcX_R + R * this._dcY_R;
            this._dcX_R = v2;
            this._dcY_R = dcY_R;

            // 振幅归一化：将信号压缩到 [-1.0, 1.0] 避免声卡爆音
            const outL = Math.max(-1, Math.min(1, (dcY_L / 3.3) * 1.5));
            const outR = Math.max(-1, Math.min(1, (dcY_R / 3.3) * 1.5));
            
            // 2. 动态相位重采样 (Resampling)：无论串口是 10Hz 还是 1000kHz，完美适配声卡
            const targetRate = Math.max(8000, Math.min(96000, currentRate));
            this.audioPhase += targetRate / currentRate;
            
            // 当相位累加满 1 时，向声卡压入一个点 (自动处理丢帧下采样和插值上采样)
            while (this.audioPhase >= 1.0) {
                this.audioPhase -= 1.0;
                this.audioAccumL.push(outL);
                this.audioAccumR.push(outR);
            }
            
            if (this.audioAccumL.length >= BUFFER.AUDIO_CHUNK) {
                this.playAudioChunk(targetRate);
            }
        }
    },

    /**
     * 音频流物理调度器
     */
    playAudioChunk: function(playRate) {
        if (!AudioState.audioCtx || AudioState.audioCtx.state !== 'running') return;
        
        const ctx = AudioState.audioCtx;

        if (!this.masterGain) {
            this.masterGain = ctx.createGain();
            this.masterGain.gain.value = AUDIO.MASTER_VOLUME || 0.5;
            this.masterGain.connect(ctx.destination);
        }

        const len = this.audioAccumL.length;
        if (len === 0) return;
        
        // 直接使用严格算好的 playRate
        const buffer = ctx.createBuffer(2, len, playRate);
        buffer.copyToChannel(new Float32Array(this.audioAccumL), 0);
        buffer.copyToChannel(new Float32Array(this.audioAccumR), 1);
        
        this.audioAccumL = [];
        this.audioAccumR = [];
        
        const now = ctx.currentTime;
        
        // 智能防积压同步机制
        if (this.audioNextTime < now) {
            this.audioNextTime = now + 0.05;
        } else if (this.audioNextTime > now + 0.5) {
            // 如果严重超前，不要直接 return 导致数据断崖，而是重置播放游标强制对齐
            this.audioNextTime = now + 0.05;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.masterGain);
        
        source.start(this.audioNextTime);
        this.audioNextTime += buffer.duration;
    },

    /**
     * 将环形缓冲区的数据解包到线性渲染数组 (8 通道)
     * 性能优化：使用TypedArray的set方法进行批量复制
     * 注意：由于ring缓冲区是循环写入的，head位置不断变化，
     * 所以每次都需要重新排列数据到线性缓冲区
     */
    fillData: function(out1, out2, out3, out4, out5, out6, out7, out8) {
        const outs = [out1, out2, out3, out4, out5, out6, out7, out8];
        const ringSize = this.ringSize; // 524288

        // 计算环形缓冲区的读取起始位置
        // 从head位置往前数ringSize个点，即读取最新的ringSize个数据
        let readIdx = (this.head - ringSize + ringSize) % ringSize;

        // 如果readIdx没有变化，说明没有新数据，跳过复制
        if (this._lastReadIdx === readIdx && this._lastHead === this.head) {
            return;
        }
        this._lastReadIdx = readIdx;
        this._lastHead = this.head;

        for (let ch = 0; ch < CHANNEL_COUNT && outs[ch]; ch++) {
            let ring = this['ring' + (ch + 1)];
            // 使用TypedArray.set进行批量复制，比逐元素复制快10倍以上
            if (readIdx === 0) {
                // 数据从缓冲区开头开始连续存储
                outs[ch].set(ring);
            } else {
                // 数据跨越缓冲区边界，需要分两段复制
                const firstPart = ringSize - readIdx;
                outs[ch].set(ring.subarray(readIdx, ringSize), 0);
                outs[ch].set(ring.subarray(0, readIdx), firstPart);
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
     * 重置所有通道到默认状态（用于模式切换时）
     */
    resetChannelsToDefault: function() {
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            const ch = STATE['ch' + i];
            ch.scale = 4.0;  // 默认scale
            ch.pos = 0;      // 默认位置（居中）
        }
    },

    /**
     * 更新FFT频率范围UI以匹配当前采样率
     */
    updateFftFreqRange: function() {
        const maxFreq = getMaxFreqForCurrentMode();
        const fftMaxKnob = document.getElementById('knob-fft-max');
        const fftMaxLbl = document.getElementById('lbl-fft-max');
        
        if (fftMaxKnob) {
            fftMaxKnob.max = maxFreq;
            if (STATE.fft.maxFreq > maxFreq) {
                STATE.fft.maxFreq = maxFreq;
                fftMaxKnob.value = maxFreq;
            }
        }
        
        if (fftMaxLbl) {
            fftMaxLbl.innerText = STATE.fft.maxFreq + 'Hz';
        }
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