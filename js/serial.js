import { CONFIG, DOM, STATE, Buffers, showSysModal } from './core.js';

/**
 * 串口引擎：负责 Web Serial 通信、协议解析及系统模式切换
 */
export const SerialEngine = {
    port: null,
    reader: null,
    keepReading: false,
    rawBuffer: [],
    textBuffer: '',
    textDecoder: new TextDecoder(),
    ringL: new Float32Array(CONFIG.fftSize),
    ringR: new Float32Array(CONFIG.fftSize),
    head: 0,

    /**
     * 🚀 动态量程切换中枢
     * 根据波特率自动调整 SEC/DIV 的 min/max 范围，防止波形显示为“折线”
     */
    switchMode: function(isSerial) {
        const timebase = DOM.knobTimebase;
        
        if (isSerial) {
            const baud = parseInt(DOM.serialBaud.value);
            
            // 1. 计算理论采样率 (JustFloat: 10 bits/byte * 12 bytes/frame)
            // 公式: fs = baud / 120
            const estimatedRate = Math.floor(baud / 120);
            
            STATE.current.isSerial = true;
            STATE.current.sampleRate = estimatedRate;
            STATE.current.lineSize = 0.002; // 串口加粗渲染

            // 2. 🚀 动态计算时基范围 (ms/div)
            // 为了防止正弦波变成折线，我们强制每个格子(div)至少包含 10 个采样点
            // 最小 ms/div = (10 点 / 采样率) * 1000
            let minMs = (10 / estimatedRate) * 1000;
            
            // 限制硬件/渲染极限：最小不低于 0.1ms (对应 12M 波特率)
            if (minMs < 0.1) minMs = 0.1;

            // 最大 ms/div: 每个格子显示约 500 个点，用于观察长周期信号
            let maxMs = (500 / estimatedRate) * 1000;
            
            // 确保缩放空间至少有 10 倍
            if (maxMs < minMs * 10) maxMs = minMs * 10;

            // 3. 更新 HTML 滑块属性
            timebase.min = minMs.toFixed(2);
            timebase.max = maxMs.toFixed(1);
            
            // 根据量程决定步进精度
            timebase.step = (minMs < 1) ? "0.1" : "1";
            
            // 4. 设置默认初始值 (显示约 50 个点/格，这是视觉最舒适的密度)
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
            // 🔙 回归音频模式 (固定的 96kSa/s 范围)
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
        
        // 🚀 核心：手动触发 input 事件，让 main.js 里的监听器感知到范围变化并刷新 WebGL
        timebase.dispatchEvent(new Event('input'));
        
        // 更新连接状态点和按钮显示
        this.updateUI(isSerial);
    },

    // 连接设备
    connect: async function() {
        if (!('serial' in navigator)) return showSysModal('不支持', '请使用 Chrome/Edge 浏览器');
        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: parseInt(DOM.serialBaud.value), bufferSize: 4096 });
            this.keepReading = true;
            STATE.serial.connected = true;
            
            // 🚀 执行模式切换
            this.switchMode(true); 
            
            this.readLoop();
        } catch (e) { showSysModal('连接失败', e.message); }
    },

    // 断开设备
    disconnect: async function() {
        this.keepReading = false;
        if (this.reader) await this.reader.cancel();
        if (this.port) await this.port.close();
        STATE.serial.connected = false;
        
        // 🚀 执行模式恢复
        this.switchMode(false); 
    },

    // 协议解析逻辑 (保持之前的高性能版本)
    parseData: function(data) { DOM.serialProtocol.value === 'justfloat' ? this.parseJustFloat(data) : this.parseFireWater(data); },
    
    parseJustFloat: function(data) {
        for (let i = 0; i < data.length; i++) this.rawBuffer.push(data[i]);
        while (this.rawBuffer.length >= 12) {
            let s1 = this.findSync(0); 
            if (s1 === -1) { this.rawBuffer = []; break; }
            let s2 = this.findSync(s1 + 4); 
            if (s2 === -1) break;
            const payload = this.rawBuffer.slice(s1 + 4, s2);
            if (payload.length > 0 && payload.length % 4 === 0) this.pushToRings(this.bytesToFloats(payload));
            this.rawBuffer = this.rawBuffer.slice(s2);
        }
    },

    parseFireWater: function(data) {
        this.textBuffer += this.textDecoder.decode(data, { stream: true });
        let lines = this.textBuffer.split(/\r?\n/); 
        this.textBuffer = lines.pop();
        for (let l of lines) {
            let s = l.trim(); 
            if (!s) continue; 
            if (s.includes(':')) s = s.split(':')[1];
            const v = s.split(',').map(p => parseFloat(p)).filter(n => !isNaN(n));
            if (v.length > 0) this.pushToRings(v);
        }
    },

    findSync: function(st) { 
        // JustFloat 同步字: 00 00 80 7F
        for (let i = st; i <= this.rawBuffer.length - 4; i++) { 
            if (this.rawBuffer[i]===0x00 && this.rawBuffer[i+1]===0x00 && 
                this.rawBuffer[i+2]===0x80 && this.rawBuffer[i+3]===0x7F) return i; 
        } 
        return -1; 
    },

    bytesToFloats: function(b) { 
        const v = new DataView(new Uint8Array(b).buffer); 
        const f = []; 
        for (let i = 0; i < b.length; i += 4) f.push(v.getFloat32(i, true)); 
        return f; 
    },

    pushToRings: function(v) { 
        const v1 = v[0]||0, v2 = v.length>1?v[1]:v1; 
        this.ringL[this.head]=v1; 
        this.ringR[this.head]=v2; 
        this.head=(this.head+1)%CONFIG.fftSize; 
    },

    fillData: function(outL, outR) { 
        for (let i = 0; i < CONFIG.fftSize; i++) { 
            let idx = (this.head - CONFIG.fftSize + i + CONFIG.fftSize) % CONFIG.fftSize; 
            outL[i] = this.ringL[idx]; outR[i] = this.ringR[idx]; 
        } 
    },

    updateUI: function(c) {
        DOM.serialStatusDot.innerText = c ? '● CONNECTED' : '● DISCONNECTED';
        DOM.serialStatusDot.className = c ? 'status-active' : '';
        DOM.btnSerialOpen.style.display = c ? 'none' : 'block';
        DOM.btnSerialClose.style.display = c ? 'block' : 'none';
    },

    async readLoop() {
        while (this.keepReading && this.port.readable) {
            this.reader = this.port.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    this.parseData(value);
                }
            } catch (e) { console.warn(e); } finally { this.reader.releaseLock(); }
        }
    }
};