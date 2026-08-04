import { CONFIG, DOM, STATE, Buffers, showSysModal, CHANNEL_COUNT } from './core.js';
import { AudioState } from './audio.js';
import { SYSTEM, BUFFER, SERIAL, AUDIO } from './constants.js';
import { parseJustFloat, parseFireWater, parseCSV, parseJSONLines } from './serial/protocols.js';
import { initCache, updateCache, getDownsampledData } from './serial/cache.js';
import { updateFftFreqRange as updateSharedFftFreqRange } from './controllers/fftController.js';
import { createAudioMonitorState, feedAudioMonitor, resetAudioMonitor } from './serial/audio.js';

/**
 * ==========================================
 * 串口通信引擎 (Serial Engine)
 * 负责 Web Serial 通信、协议解析、系统模式切换及数据可听匀
 * ==========================================
 */
export const SerialEngine = {
    // ---- 基础串口状怀----
    port: null,
    reader: null,
    keepReading: false,

    // ---- 连接状态回调（替代轮询＀---
    _onConnect: null,
    _onDisconnect: null,

    /**
     * 注册连接状态变化的回调
     * @param {Function} onConnect - 连接时触叀(state) => void
     * @param {Function} onDisconnect - 断开时触叀() => void
     */
    setStateChangeCallbacks: function (onConnect, onDisconnect) {
        this._onConnect = onConnect;
        this._onDisconnect = onDisconnect;
    },

    // ---- 协议解析缓冲 ----
    linearBuffer: new Uint8Array(0),
    textBuffer: '',
    textDecoder: new TextDecoder(),

    // ---- 示波器环形缓冲区 (8通道) ----
    ring1: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring2: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring3: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring4: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring5: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring6: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring7: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    ring8: new Float32Array(BUFFER.SERIAL_FFT_SIZE),
    head: 0,
    ringSize: BUFFER.SERIAL_FFT_SIZE,

    // fillData 缓存优化
    _lastReadIdx: -1,
    _lastHead: -1,

    // ---- 降采样缓孀----
    _cacheState: null,

    // ---- 音频监听 ----
    _audioMon: null,

    // ========================================
    // 连接/断开
    // ========================================

    /**
     * 连接 Web Serial 设备
     */
    connect: async function () {
        if (!('serial' in navigator)) {
            return showSysModal('环境不支持', '请使用基于 Chromium 的现代浏览器，例如 Chrome 或 Edge。');
        }
        try {
            this.port = await navigator.serial.requestPort();
            const baudRate = parseInt(DOM.serialBaud.value);
            await this.port.open({ baudRate: baudRate, bufferSize: BUFFER.SERIAL_BUFFER });

            this.keepReading = true;
            STATE.serial.connected = true;
            STATE.serial.baud = baudRate;

            this.switchMode(true);
            this.readLoop();

            // 初始化降采样缓存
            this._cacheState = initCache(this.ringSize);

            this.updateFftFreqRange();

            if (this._onConnect) this._onConnect(true);
        } catch (e) {
            showSysModal('连接失败', e.message);
        }
    },

    /**
     * 断开 Web Serial 设备
     */
    disconnect: async function () {
        this.keepReading = false;

        try {
            if (this.reader) {
                await this.reader.cancel().catch(() => { });
            }
        } catch (e) { }

        try {
            if (this.port) {
                await this.port.close().catch(() => { });
            }
        } catch (e) { }

        this.finalizeDisconnect();
    },

    finalizeDisconnect: function () {
        this.keepReading = false;
        this.reader = null;
        this.port = null;
        STATE.serial.connected = false;
        STATE.serial.baud = SERIAL.DEFAULT_BAUD;

        this.clearAllRings();
        this.switchMode(false);
        if (this._onDisconnect) this._onDisconnect();
    },

    /**
     * Clear all channel ring buffers and linear render buffers.
     */
    clearAllRings: function () {
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            this['ring' + i].fill(0);
            Buffers['data' + i].fill(0);
            Buffers['pData' + i].fill(0);
        }
        this.head = 0;
        this.linearBuffer = new Uint8Array(0);
    },

    // ========================================
    // 协议解析分发
    // ========================================

    parseData: function (data) {
        const protocol = DOM.serialProtocol.value;
        if (protocol === 'justfloat') {
            this.linearBuffer = parseJustFloat(data, this.linearBuffer, (samples) => {
                this.pushToRings(samples);
            });
        } else if (protocol === 'csv') {
            this.textBuffer = parseCSV(data, this.textBuffer, this.textDecoder, (samples) => {
                this.pushToRings(samples);
            });
        } else if (protocol === 'jsonlines') {
            this.textBuffer = parseJSONLines(data, this.textBuffer, this.textDecoder, (samples) => {
                this.pushToRings(samples);
            });
        } else {
            this.textBuffer = parseFireWater(data, this.textBuffer, this.textDecoder, (samples) => {
                this.pushToRings(samples);
            });
        }
    },

    // ========================================
    // 渲染缓冲与音频调度核忀
    // ========================================

    pushToRings: function (v) {
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            this['ring' + i][this.head] = v[i - 1] !== undefined ? v[i - 1] : 0;
        }
        this.head = (this.head + 1) % this.ringSize;

        // 真实采样率打炀
        if (STATE.realSampleMeasurer) {
            STATE.realSampleMeasurer.frameCount += 1;
        }

        // 音频监听
        if (STATE.serial && STATE.serial.speaker) {
            const currentRate = STATE.current.sampleRate || 16000;
            if (!this._audioMon) this._audioMon = createAudioMonitorState();
            feedAudioMonitor(
                this._audioMon, v,
                (STATE.serialOutL || 1) - 1,
                (STATE.serialOutR || 2) - 1,
                currentRate
            );
        }
    },

    /**
     * 将环形缓冲区的数据解包到线性渲染数绀(8 通道)
     */
    fillData: function (out1, out2, out3, out4, out5, out6, out7, out8) {
        const outs = [out1, out2, out3, out4, out5, out6, out7, out8];
        const ringSize = this.ringSize;
        let readIdx = (this.head - ringSize + ringSize) % ringSize;

        if (this._lastReadIdx === readIdx && this._lastHead === this.head) return;
        this._lastReadIdx = readIdx;
        this._lastHead = this.head;

        for (let ch = 0; ch < CHANNEL_COUNT && outs[ch]; ch++) {
            const ring = this['ring' + (ch + 1)];
            if (readIdx === 0) {
                outs[ch].set(ring);
            } else {
                const firstPart = ringSize - readIdx;
                outs[ch].set(ring.subarray(readIdx, ringSize), 0);
                outs[ch].set(ring.subarray(0, readIdx), firstPart);
            }
        }

        // 异步更新降采样缓孀
        if (!this._cacheUpdatePending) {
            this._cacheUpdatePending = true;
            setTimeout(() => {
                if (this._cacheState) {
                    // 获取所最ring 通道
                    const rings = {};
                    for (let i = 1; i <= CHANNEL_COUNT; i++) rings['ring' + i] = this['ring' + i];
                    updateCache(this._cacheState, rings, this.ringSize);
                }
                this._cacheUpdatePending = false;
            }, 0);
        }
    },

    // ========================================
    // 扬声器控刀
    // ========================================

    toggleSpeaker: function (isOn) {
        STATE.serial.speaker = isOn;

        if (isOn) {
            this._audioMon = createAudioMonitorState();
        } else {
            if (this._audioMon) resetAudioMonitor(this._audioMon);
            this._audioMon = null;
        }

        if (this._audioMon && this._audioMon.masterGain && AudioState.audioCtx) {
            const now = AudioState.audioCtx.currentTime;
            this._audioMon.masterGain.gain.setTargetAtTime(isOn ? 0.5 : 0, now, 0.02);
        }
    },

    // ========================================
    // 模式切换
    // ========================================

    switchMode: function (isSerial) {
        const timebase = DOM.knobTimebase;

        if (isSerial) {
            const baud = parseInt(DOM.serialBaud.value);
            const isHighSpeed = baud > 1000000;
            const bytesPerFrame = isHighSpeed ? 7 : SERIAL.BYTES_PER_FRAME;
            const estimatedRate = Math.floor(baud / bytesPerFrame);

            STATE.current.isSerial = true;
            STATE.current.sampleRate = estimatedRate;
            STATE.current.lineSize = 0.002;
            STATE.current.isHighSpeed = isHighSpeed;

            let minMs = 0.1;
            let maxMs = (BUFFER.SERIAL_FFT_SIZE / estimatedRate) * 1000 / 10;
            if (maxMs > 10000) maxMs = 10000;
            if (maxMs < minMs * 10) maxMs = minMs * 10;

            STATE.current.timebaseMin = minMs;
            STATE.current.timebaseMax = maxMs;

            timebase.min = "-50";
            timebase.max = "50";
            timebase.step = "0.01";
            timebase.value = "0";

            const defaultSecPerDiv = 1.0;
            STATE.secPerDiv = defaultSecPerDiv;

            DOM.lblTimebase.innerText = defaultSecPerDiv.toFixed(2) + "ms";
        } else {
            STATE.current.isSerial = false;
            STATE.current.sampleRate = CONFIG.sampleRate;
            STATE.current.lineSize = 0.002;

            timebase.min = "-50";
            timebase.max = "50";
            timebase.step = "0.01";
            timebase.value = "0";

            const defaultSecPerDiv = 1.0;
            STATE.secPerDiv = defaultSecPerDiv;

            let minMs = 0.1;
            let maxMs = (BUFFER.FFT_SIZE / CONFIG.sampleRate) * 1000 / 10;
            if (maxMs > 500) maxMs = 500;
            if (maxMs < minMs * 10) maxMs = minMs * 10;

            STATE.current.timebaseMin = minMs;
            STATE.current.timebaseMax = maxMs;

            DOM.lblTimebase.innerText = defaultSecPerDiv.toFixed(2) + "ms";

            this.resetChannelsToDefault();
            this.updateFftFreqRange();
        }

        timebase.dispatchEvent(new Event('input'));
        this.updateUI(isSerial);
    },

    /**
     * 更新串口状怀UI
     */
    updateUI: function (c) {
        DOM.serialStatusDot.innerText = c ? '●CONNECTED' : '●DISCONNECTED';
        DOM.serialStatusDot.style.color = c ? '#4ade80' : '#ef4444';
        DOM.btnSerialOpen.style.display = c ? 'none' : 'block';
        DOM.btnSerialClose.style.display = c ? 'block' : 'none';
    },

    /**
     * 重置所有通道到默认状怀
     */
    resetChannelsToDefault: function () {
        for (let i = 1; i <= CHANNEL_COUNT; i++) {
            const ch = STATE['ch' + i];
            ch.scale = 4.0;
            ch.pos = 0;
        }
    },

    /**
     * 更新FFT频率范围UI（委托共享实现，避免重复代码）
     */
    updateFftFreqRange: function () {
        updateSharedFftFreqRange();
    },

    // ========================================
    // 后台读取循环
    // ========================================

    async readLoop() {
        try {
            while (this.keepReading && this.port && this.port.readable) {
                const reader = this.port.readable.getReader();
                this.reader = reader;
                try {
                    while (this.keepReading) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        this.parseData(value);
                    }
                } catch (e) {
                    if (this.keepReading) console.warn("Serial read error:", e);
                } finally {
                    if (this.reader === reader) this.reader = null;
                    try { reader.releaseLock(); } catch (e) { }
                }
            }
        } finally {
            if (STATE.serial.connected) this.finalizeDisconnect();
        }
    }
};
