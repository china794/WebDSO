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
import { initBytebeatEditor } from '../bytebeat/editor.js';

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
    // 公式输入 (简易 IDE 编辑器: 行号 + 语法高亮 + 自动增高)
    if (DOM.bytebeatCode && DOM.bbLineNums && DOM.bbHighlight) {
        const editor = initBytebeatEditor(DOM.bytebeatCode, DOM.bbLineNums, DOM.bbHighlight);
        DOM.bytebeatCode.addEventListener('input', (e) => {
            setBytebeatCode(e.target.value);
        });
        // 暴露给曲库选择等外部改值时刷新编辑器视觉
        window.__bytebeatEditorRefresh = editor.refresh;
    } else if (DOM.bytebeatCode) {
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

    // 曲库选择 (change 事件来自隐藏 select 或自定义下拉, 统一走 applySong)
    if (DOM.bytebeatSong) {
        DOM.bytebeatSong.addEventListener('change', (e) => {
            applySong(parseInt(e.target.value));
        });
    }

    // 曲库搜索过滤
    if (DOM.bytebeatSearch) {
        let debounceTimer = null;
        DOM.bytebeatSearch.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => filterLibrary(e.target.value), 150);
        });
    }

    // 自定义下拉交互
    if (DOM.bbPickerTrigger) {
        DOM.bbPickerTrigger.addEventListener('click', togglePicker);
    }
    if (DOM.bbPickerTrigger && DOM.bbPickerDropdown) {
        DOM.bbPickerDropdown.addEventListener('click', (e) => e.stopPropagation());
    }
    document.addEventListener('click', (e) => {
        const picker = DOM.bbPicker;
        if (picker && !picker.contains(e.target)) {
            closePicker();
        }
    });

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

/**
 * 把曲目按作者分组, 返回排序后的 [author, items][] 数组。
 * @param {Array} songs - {song, i}[] 格式
 */
function groupByAuthor(songs) {
    const byAuthor = new Map();
    songs.forEach(item => {
        const a = item.song.author || '未知作者';
        if (!byAuthor.has(a)) byAuthor.set(a, []);
        byAuthor.get(a).push(item);
    });
    // 作者按曲目数降序
    return [...byAuthor.entries()].sort((a, b) => b[1].length - a[1].length);
}

/** 曲目彩色标签 HTML: 立体声(紫) / 经典(金) / 采样率 */
function songTagsHTML(song) {
    let html = '';
    if (song.stereo) html += '<span class="bb-tag bb-tag-stereo">立体声</span>';
    if (song.tags && song.tags.includes('c')) html += '<span class="bb-tag bb-tag-classic">经典</span>';
    if (song.sampleRate) html += '<span class="bb-tag-sr">' + song.sampleRate + 'Hz</span>';
    return html;
}

/**
 * 把 {song, i}[] 渲染成自定义下拉的作者分组 DOM, 追加到容器。
 * 懒渲染: 每组默认只渲染前 SHOW_FIRST 首, 展开按钮显示剩余。
 * @param {HTMLElement} container - .bb-picker-dropdown
 * @param {Array} groups - groupByAuthor 的返回值
 * @param {string} cls - 组样式 ('' 或 'mono')
 */
function appendPickerGroups(container, groups, cls) {
    const SHOW_FIRST = 8;
    for (const [author, items] of groups) {
        const group = document.createElement('div');
        group.className = 'bb-picker-group';

        const label = document.createElement('div');
        label.className = 'bb-picker-label' + (cls ? ' ' + cls : '');
        label.innerHTML = escapeHtml(author) + '<span class="bb-picker-cnt">(' + items.length + ')</span>';
        group.appendChild(label);

        // 前 SHOW_FIRST 首
        const visible = items.slice(0, SHOW_FIRST);
        for (const { song, i } of visible) {
            group.appendChild(makePickerItem(song, i));
        }
        // 剩余曲目: 展开按钮
        const hidden = items.slice(SHOW_FIRST);
        if (hidden.length) {
            const more = document.createElement('div');
            more.className = 'bb-picker-more';
            more.textContent = '展开全部 ' + hidden.length + ' 首 ▾';
            more.addEventListener('click', () => {
                for (const { song, i } of hidden) {
                    group.insertBefore(makePickerItem(song, i), more);
                }
                more.remove();
            });
            group.appendChild(more);
        }
        container.appendChild(group);
    }
}

/** 创建单个曲目条目 DOM */
function makePickerItem(song, i) {
    const item = document.createElement('div');
    item.className = 'bb-picker-item';
    item.dataset.idx = String(i);
    const name = document.createElement('span');
    name.className = 'bb-picker-item-name';
    name.textContent = song.name;
    name.title = song.name + (song.author ? ' — ' + song.author : '');
    item.appendChild(name);
    item.insertAdjacentHTML('beforeend', songTagsHTML(song));
    item.addEventListener('click', () => selectSong(i));
    return item;
}

/**
 * 填充 bytebeat 曲库自定义下拉。
 * 立体声组在前(🎧), 单声道在后; 各自按作者分组; 彩色标签 + 懒渲染。
 */
function populateBytebeatLibrary() {
    const picker = DOM.bbPickerDropdown;
    const valueEl = DOM.bbPickerValue;
    if (!picker) return;
    if (valueEl) valueEl.textContent = '选择曲目 (' + BYTEBEAT_LIBRARY.length + ' 首)';

    // 同步隐藏 select (保留选中值机制): 填充所有 option 供 selectSong 设置 value
    const sel = DOM.bytebeatSong;
    if (sel) {
        let optHtml = '<option value="-1" disabled selected>选择曲目</option>';
        BYTEBEAT_LIBRARY.forEach((song, i) => {
            optHtml += '<option value="' + i + '">' + escapeHtml(song.name) + '</option>';
        });
        sel.innerHTML = optHtml;
    }

    renderPicker(BYTEBEAT_LIBRARY.map((song, i) => ({ song, i })));
}

/** 渲染 picker: 立体声在前 */
function renderPicker(items) {
    const picker = DOM.bbPickerDropdown;
    if (!picker) return;
    picker.innerHTML = '';

    const stereoItems = items.filter(it => it.song.stereo);
    const monoItems = items.filter(it => !it.song.stereo);

    if (stereoItems.length) appendPickerGroups(picker, groupByAuthor(stereoItems), '');
    if (monoItems.length) appendPickerGroups(picker, groupByAuthor(monoItems), 'mono');
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'bb-picker-empty';
        empty.textContent = '无匹配曲目';
        picker.appendChild(empty);
    }
}

/** 按搜索词过滤曲库: 只渲染匹配项, 立体声仍在前 */
function filterLibrary(query) {
    const q = query.trim().toLowerCase();
    const items = [];
    BYTEBEAT_LIBRARY.forEach((song, i) => {
        const hay = (song.name + ' ' + (song.author || '') + ' ' + (song.tags || []).join(' ')).toLowerCase();
        if (!q || hay.includes(q)) items.push({ song, i });
    });
    renderPicker(items);
    // 更新 trigger 显示
    const valueEl = DOM.bbPickerValue;
    if (valueEl && q) valueEl.textContent = '搜索到 ' + items.length + ' 首';
    else if (valueEl) valueEl.textContent = '选择曲目 (' + BYTEBEAT_LIBRARY.length + ' 首)';
}

/** 选中曲目: 更新 trigger + 同步 select + 触发现有选曲逻辑 */
/** 应用选中的曲目: 设置 mode/rate/加载代码 (change 事件与自定义下拉共用) */
async function applySong(idx) {
    const song = BYTEBEAT_LIBRARY[idx];
    if (!song) return;
    setBytebeatMode(song.mode);
    setBytebeatSampleRate(song.sampleRate);
    if (DOM.bytebeatMode) DOM.bytebeatMode.value = song.mode;
    if (DOM.bytebeatRate) DOM.bytebeatRate.value = song.sampleRate;
    showSongInfo();

    let code = song.code;
    // 大曲目: 按需动态加载单独文件
    if (song.file && !code) {
        try {
            const mod = await import('../bytebeat/songs/' + song.file + '.js');
            code = mod.code;
        } catch (err) {
            console.warn('加载大曲目失败:', song.name, err);
            return;
        }
    }
    if (!code) return;
    setBytebeatCode(code);
    if (DOM.bytebeatCode) DOM.bytebeatCode.value = code;
    if (window.__bytebeatEditorRefresh) window.__bytebeatEditorRefresh();
}

function selectSong(idx) {
    const song = BYTEBEAT_LIBRARY[idx];
    if (!song) return;

    // 更新 trigger 显示
    const valueEl = DOM.bbPickerValue;
    if (valueEl) {
        valueEl.textContent = song.name;
        // 在 trigger 里也显示彩色标签
        const trigger = DOM.bbPickerTrigger;
        if (trigger) {
            const oldTags = trigger.querySelector('.bb-picker-trigger-tags');
            if (oldTags) oldTags.remove();
            const tags = document.createElement('span');
            tags.className = 'bb-picker-trigger-tags';
            tags.innerHTML = songTagsHTML(song);
            valueEl.insertAdjacentElement('afterend', tags);
        }
    }

    // 同步隐藏 select 并触发 change (复用现有选曲逻辑)
    const sel = DOM.bytebeatSong;
    if (sel) {
        sel.value = String(idx);
        sel.dispatchEvent(new Event('change'));
    }

    // 收起下拉
    closePicker();
    // 标记选中项
    const dropdown = DOM.bbPickerDropdown;
    if (dropdown) {
        dropdown.querySelectorAll('.bb-picker-item').forEach(el => {
            el.classList.toggle('selected', el.dataset.idx === String(idx));
        });
    }
}

/** 展开/收起自定义下拉 */
function togglePicker() {
    const dropdown = DOM.bbPickerDropdown;
    const trigger = DOM.bbPickerTrigger;
    if (!dropdown) return;
    const isOpen = dropdown.style.display !== 'none';
    if (isOpen) {
        closePicker();
    } else {
        dropdown.style.display = 'block';
        if (trigger) trigger.classList.add('open');
    }
}

function closePicker() {
    const dropdown = DOM.bbPickerDropdown;
    const trigger = DOM.bbPickerTrigger;
    if (dropdown) dropdown.style.display = 'none';
    if (trigger) trigger.classList.remove('open');
}

/** 显示当前选中曲目的元信息 */
function showSongInfo() {
    const infoEl = DOM.bytebeatSongInfo;
    if (!infoEl) return;
    const idx = parseInt(DOM.bytebeatSong.value);
    const song = BYTEBEAT_LIBRARY[idx];
    if (!song) {
        infoEl.style.display = 'none';
        return;
    }
    const tags = (song.tags || []).join(', ');
    infoEl.innerHTML = '<div class="bb-song-meta">'
        + '<b>' + escapeHtml(song.name || '') + '</b>'
        + (song.author ? ' <span>by ' + escapeHtml(song.author) + '</span>' : '')
        + '<div class="bb-song-detail">'
        + (song.mode ? '模式: ' + escapeHtml(song.mode) : '')
        + (song.sampleRate ? ' | 采样率: ' + song.sampleRate + 'Hz' : '')
        + (song.stereo ? ' | 立体声' : '')
        + (tags ? ' | 标签: ' + escapeHtml(tags) : '')
        + '</div>'
        + (song.description ? '<div class="bb-song-desc">' + escapeHtml(song.description) + '</div>' : '')
        + '</div>';
    infoEl.style.display = 'block';
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
