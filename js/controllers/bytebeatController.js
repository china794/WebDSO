/**
 * ==========================================
 * Bytebeat Controller - 字节节拍信号源控制器
 * ==========================================
 * 管理 AudioWorklet 字节节拍引擎的生命周期与多声道路由。
 *
 * bytebeat 引擎输出双声道 (L/R)，作为独立信号源注入选定通道：
 *   L 声道 → 选定的 L 通道 mixer
 *   R 声道 → 选定的 R 通道 mixer
 * 注入 mixer 后经 analyser 采集，示波器自动显示波形。
 *
 * 与 AUDIO / SERIAL 平级，有独立的播放按钮。
 */

import { AudioState } from '../audio.js';
import { DOM, STATE, showSysModal } from '../core.js';
import { BYTEBEAT } from '../constants.js';
import { BYTEBEAT_LIBRARY, DEFAULT_BYTEBEAT_CODE, DEFAULT_BYTEBEAT_MODE, DEFAULT_BYTEBEAT_SAMPLE_RATE } from '../bytebeat/library.js';

// Worklet 模块路径（相对 index.html）
const WORKLET_URL = BYTEBEAT.WORKLET_URL;
const PROCESSOR_NAME = BYTEBEAT.PROCESSOR_NAME;

/** 共享 bytebeat 引擎状态 */
export const BytebeatEngine = {
    /** 全局共享的 AudioWorkletNode */
    node: null,
    /** 双声道分离器：worklet L/R → 目标通道 */
    splitter: null,
    /** 扬声器监听增益 (splitter → monitorGain → destination) */
    monitorGain: null,
    /** 加载状态 */
    loaded: false,
    loadPromise: null,
    /** 当前公式/模式/采样率 */
    code: DEFAULT_BYTEBEAT_CODE,
    mode: DEFAULT_BYTEBEAT_MODE,
    sampleRate: DEFAULT_BYTEBEAT_SAMPLE_RATE,
    /** 是否有通道在使用 */
    active: false,
    /** 运行时错误 */
    error: '',
};

/** 确保 worklet 已加载（幂等） */
export function ensureWorkletLoaded() {
    const audioCtx = AudioState.audioCtx;
    if (!audioCtx) return Promise.resolve(false);
    if (BytebeatEngine.loaded) return Promise.resolve(true);
    if (BytebeatEngine.loadPromise) return BytebeatEngine.loadPromise;

    BytebeatEngine.loadPromise = audioCtx.audioWorklet.addModule(WORKLET_URL)
        .then(() => {
            BytebeatEngine.loaded = true;
            return true;
        })
        .catch((err) => {
            console.warn('Bytebeat worklet 加载失败:', err);
            BytebeatEngine.loaded = false;
            BytebeatEngine.loadPromise = null;
            return false;
        });
    return BytebeatEngine.loadPromise;
}

/** 创建共享 bytebeat 节点 + 双声道分离器（幂等） */
export function ensureBytebeatNode() {
    const audioCtx = AudioState.audioCtx;
    if (!audioCtx) return null;
    if (BytebeatEngine.node) return BytebeatEngine.node;

    const node = new AudioWorkletNode(audioCtx, PROCESSOR_NAME, {
        outputChannelCount: [2],
        numberOfInputs: 0,
        numberOfOutputs: 1
    });

    node.port.addEventListener('message', (event) => {
        const data = event.data;
        if (data && data.error) {
            BytebeatEngine.error = data.error.message || '';
            updateErrorUI();
            // 关键: worklet 的 errorDisplayed 防刷屏机制——错误上报后置 false,
            // 必须由主线程显式回发 errorDisplayed:true 才能继续上报下一条。
            // 否则错误信息只显示第一帧就冻结, bytebeat 用错误信息做的动画不会动。
            node.port.postMessage({ errorDisplayed: true });
        }
    });
    node.port.start();

    // 双声道分离器：L → ch0, R → ch1
    const splitter = audioCtx.createChannelSplitter(2);
    node.connect(splitter);

    // 扬声器监听路径：splitter → monitorGain → destination (永远默认开启)
    // bytebeat 本身就是可听音乐, 监听常开无需开关。
    const monitorGain = audioCtx.createGain();
    monitorGain.gain.value = 1.0;
    splitter.connect(monitorGain);
    monitorGain.connect(audioCtx.destination);

    BytebeatEngine.node = node;
    BytebeatEngine.splitter = splitter;
    BytebeatEngine.monitorGain = monitorGain;
    return node;
}

/** 重建双声道路由：L 声道 → STATE.bytebeat.L 通道，R → R 通道 */
export function updateBytebeatRouting() {
    if (!BytebeatEngine.splitter || !AudioState.audioCtx) return;
    const L = STATE.bytebeat.L || BYTEBEAT.DEFAULT_L_CH;
    const R = STATE.bytebeat.R || BYTEBEAT.DEFAULT_R_CH;

    // 断开旧的 L/R 到 mixer 的连接。
    // ⚠️ 绝不能用 splitter.disconnect() 全断 —— 那会把 splitter→monitorGain 的
    // 监听路径(永久开启)一起断开, 导致 bytebeat 无声。
    // 这里只断开到目标 mixer 的输出, 用 disconnect(dest) 精确断开。
    const splitter = BytebeatEngine.splitter;
    const targetL = AudioState['ch' + L + 'Mixer'];
    const targetR = AudioState['ch' + R + 'Mixer'];
    try { splitter.disconnect(targetL); } catch (e) {}
    try { splitter.disconnect(targetR); } catch (e) {}
    // 若 L===R 合并路径, 上一轮可能建过临时 merger, 一并断开
    if (targetL === targetR && targetL) { try { splitter.disconnect(targetL); } catch (e) {} }

    // 连接 L → chL Mixer, R → chR Mixer（若相同通道则合并）
    if (L === R && targetL) {
        // 双声道混合到同一通道（简单求和）
        const merger = AudioState.audioCtx.createChannelMerger(1);
        splitter.connect(merger, 0, 0);
        splitter.connect(merger, 1, 0);
        merger.connect(targetL);
    } else {
        if (targetL) splitter.connect(targetL, 0);
        if (targetR) splitter.connect(targetR, 1);
    }
}

/**
 * 同步当前状态到 worklet（公式/模式/采样率）。
 * 必须分批发送: worklet 的 receiveData 在同一消息里处理 mode + setFunction 时,
 * setFunction 内的 deleteGlobals() 会破坏全局, 导致编译后的 this.func 丢失,
 * 运行时报 "this.func is not a function" 静音。分开消息则正常。
 */
export function syncToWorklet() {
    if (!BytebeatEngine.node) return;
    const audioCtx = AudioState.audioCtx;
    const node = BytebeatEngine.node;
    const sampleRatio = BytebeatEngine.sampleRate / (audioCtx.sampleRate || 96000);
    // 先设模式(决定 getValues), 再独立编译公式, 最后补采样率/播放状态
    node.port.postMessage({ mode: BytebeatEngine.mode });
    node.port.postMessage({ setFunction: BytebeatEngine.code });
    node.port.postMessage({
        sampleRate: BytebeatEngine.sampleRate,
        sampleRatio,
        isPlaying: BytebeatEngine.active,
        resetTime: true
    });
}

/** 启动引擎：加载 worklet + 创建节点 + 路由 + 同步 */
export async function startBytebeat() {
    // 确保 AudioContext 已创建（用户手势内调用可正常 resume）
    if (!AudioState.audioCtx) {
        const { initAudio } = await import('../audio.js');
        initAudio();
    }
    const audioCtx = AudioState.audioCtx;
    if (!audioCtx) return;
    // 确保音频上下文运行（用户点击手势内调用可正常 resume）
    if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch (e) {}
    }
    const ok = await ensureWorkletLoaded();
    if (!ok) {
        showSysModal('Bytebeat 加载失败', 'AudioWorklet 模块无法加载。请使用支持 AudioWorklet 的浏览器。');
        return;
    }
    ensureBytebeatNode();
    BytebeatEngine.active = true;
    STATE.bytebeat.on = true;
    updateBytebeatRouting();
    syncToWorklet();
    updateBytebeatPlayUI();
}

/** 停止引擎 */
export function stopBytebeat() {
    BytebeatEngine.active = false;
    STATE.bytebeat.on = false;
    if (BytebeatEngine.node) {
        BytebeatEngine.node.port.postMessage({ isPlaying: false });
    }
    updateBytebeatPlayUI();
}

/** 设置公式（实时重编译） */
export function setBytebeatCode(code) {
    BytebeatEngine.code = code;
    if (BytebeatEngine.node) {
        BytebeatEngine.node.port.postMessage({ setFunction: code });
    }
}

/** 设置模式 */
export function setBytebeatMode(mode) {
    BytebeatEngine.mode = mode;
    if (BytebeatEngine.node) {
        BytebeatEngine.node.port.postMessage({ mode: mode, setFunction: BytebeatEngine.code });
    }
}

/** 设置采样率 */
export function setBytebeatSampleRate(sampleRate) {
    const audioCtx = AudioState.audioCtx;
    BytebeatEngine.sampleRate = sampleRate;
    if (BytebeatEngine.node) {
        BytebeatEngine.node.port.postMessage({
            sampleRate: sampleRate,
            sampleRatio: sampleRate / (audioCtx.sampleRate || 96000)
        });
    }
}

/** 设置 L 声道目标通道 */
export function setBytebeatLChannel(ch) {
    STATE.bytebeat.L = ch;
    if (BytebeatEngine.active) updateBytebeatRouting();
}

/** 设置 R 声道目标通道 */
export function setBytebeatRChannel(ch) {
    STATE.bytebeat.R = ch;
    if (BytebeatEngine.active) updateBytebeatRouting();
}

/** 更新错误提示 UI */
function updateErrorUI() {
    const el = DOM.bytebeatError;
    if (el) {
        el.textContent = BytebeatEngine.error;
        el.style.display = BytebeatEngine.error ? 'block' : 'none';
    }
}

/** 同步播放按钮 UI 到引擎状态 */
export function updateBytebeatPlayUI() {
    const btn = DOM.bytebeatPlay;
    if (!btn) return;
    btn.textContent = BytebeatEngine.active ? '⏸' : '▶';
    btn.classList.toggle('active', BytebeatEngine.active);
}

/** 初始化 UI 事件绑定 */
export function initBytebeatController() {
    // 公式输入
    if (DOM.bytebeatCode) {
        DOM.bytebeatCode.addEventListener('input', (e) => {
            setBytebeatCode(e.target.value);
        });
    }

    // 模式切换
    if (DOM.bytebeatMode) {
        DOM.bytebeatMode.addEventListener('change', (e) => {
            setBytebeatMode(e.target.value);
        });
    }

    // 采样率
    if (DOM.bytebeatRate) {
        DOM.bytebeatRate.addEventListener('change', (e) => {
            const v = parseInt(e.target.value) || 8000;
            setBytebeatSampleRate(Math.max(BYTEBEAT.MIN_SAMPLE_RATE, Math.min(BYTEBEAT.MAX_SAMPLE_RATE, v)));
        });
    }

    // 曲库选择
    if (DOM.bytebeatSong) {
        DOM.bytebeatSong.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value);
            const song = BYTEBEAT_LIBRARY[idx];
            if (!song) return;
            setBytebeatMode(song.mode);
            setBytebeatSampleRate(song.sampleRate);
            setBytebeatCode(song.code);
            if (DOM.bytebeatCode) DOM.bytebeatCode.value = song.code;
            if (DOM.bytebeatMode) DOM.bytebeatMode.value = song.mode;
            if (DOM.bytebeatRate) DOM.bytebeatRate.value = song.sampleRate;
        });
    }

    // 播放/暂停
    if (DOM.bytebeatPlay) {
        DOM.bytebeatPlay.addEventListener('click', () => {
            if (BytebeatEngine.active) {
                stopBytebeat();
            } else {
                startBytebeat();
            }
        });
    }

    // L/R 声道选择
    if (DOM.bytebeatOutLeft) {
        DOM.bytebeatOutLeft.addEventListener('change', (e) => {
            setBytebeatLChannel(parseInt(e.target.value) || 1);
        });
    }
    if (DOM.bytebeatOutRight) {
        DOM.bytebeatOutRight.addEventListener('change', (e) => {
            setBytebeatRChannel(parseInt(e.target.value) || 2);
        });
    }

    // 填充曲库
    populateBytebeatLibrary();
}

/** 填充 bytebeat 曲库下拉框 */
function populateBytebeatLibrary() {
    const sel = DOM.bytebeatSong;
    if (!sel) return;
    sel.innerHTML = '<option value="-1" disabled selected>选择预设曲目</option>';
    BYTEBEAT_LIBRARY.forEach((song, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = song.name;
        sel.appendChild(opt);
    });
}
