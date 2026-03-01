/**
 * ==========================================
 * Input Controller - 用户输入控制器
 * ==========================================
 * 负责处理所有用户输入事件绑定
 */

// TODO: 实现输入事件处理逻辑
import { STATE, DOM, CONFIG, updateTriggerUI, showSysModal, Buffers, CHANNEL_COUNT } from '../core.js';
import { MEASUREMENT, TIMEBASE, GENERATOR, CURSOR, GRID, RENDER_EXT, GENERATOR_EXT, BUFFER } from '../constants.js';

// 暴露给其他控制器使用
export let currentSelectedCh = 1;
export const getInputCh = () => parseInt(DOM.inputChSelect?.value || 1);

export const bindToggle = (domEl, prop, cb) => {
    domEl.addEventListener('click', () => {
        prop.on = !prop.on;
        domEl.classList.toggle('active', prop.on);
        if (cb) cb();
    });
};

export const bindKnob = (domInput, domLbl, domOsd, fmt, act) => {
    domInput.addEventListener('input', (e) => {
        let v = parseFloat(e.target.value);
        if (domLbl) domLbl.innerText = fmt(v);
        if (domOsd) domOsd.innerText = fmt(v);
        act(v);
    });
};

export function refreshVerticalCard(ch) {
    const c = STATE['ch' + ch];
    if (!c || !DOM.verticalChSelect) return;
    currentSelectedCh = ch;
    DOM.verticalChSelect.value = String(ch);

    for (let i = 1; i <= 8; i++) {
        const btn = DOM['ch' + i + 'Toggle'];
        if (btn) {
            const chState = STATE['ch' + i];
            btn.classList.toggle('active', chState.on);
        }
    }

    if(DOM.knobPosSel) DOM.knobPosSel.value = c.pos;
    if(DOM.lblPosSel) DOM.lblPosSel.innerText = c.pos.toFixed(2);
    
    const vPerDiv = 1 / c.scale;
    if(DOM.numScaleSel) DOM.numScaleSel.value = vPerDiv.toFixed(2);
    if(DOM.cplChSel) DOM.cplChSel.value = c.cpl;

    const chBox = document.querySelector('.ch-box');
    if (chBox) {
        for (let i = 1; i <= 8; i++) chBox.classList.remove('ch' + i);
        chBox.classList.add('ch' + ch);
    }
}

export function refreshInputCard(ch) {
    const c = STATE['ch' + ch];
    if (!c || !DOM.inputChSelect) return;
    DOM.inputChSelect.value = String(ch);
    DOM.inputGenLabel.innerText = 'CH' + ch;
    DOM.inputGenLabel.className = 'txt-ch' + ch + ' font-mono';
    
    for (let i=1; i<=8; i++) DOM.inputGenLabel.classList.remove('txt-ch'+i);
    DOM.inputGenLabel.classList.add('txt-ch' + ch);
    
    if(DOM.genTypeSel) DOM.genTypeSel.value = c.genType || 'off';
    if(DOM.numGenFreqSel) DOM.numGenFreqSel.value = c.genFreq ?? 1000;
    if(DOM.knobGenFreqSel) DOM.knobGenFreqSel.value = Math.log10(c.genFreq || GENERATOR.DEFAULT_FREQ) * GENERATOR.FREQ_SLIDER_NORM;
    if(DOM.numGenAmpSel) DOM.numGenAmpSel.value = (c.genAmp ?? GENERATOR.DEFAULT_AMP).toFixed(2);
    if(DOM.knobGenAmpSel) DOM.knobGenAmpSel.value = c.genAmp ?? GENERATOR.DEFAULT_AMP;
}

export function initInputController() {
    // 运行/停止
    if(DOM.btnRunstop) {
        DOM.btnRunstop.addEventListener('click', function () {
            STATE.run = !STATE.run;
            if (STATE.run) {
                this.classList.remove('stopped');
                this.innerText = '⏸ 暂停';
                if(DOM.osdRunState) { DOM.osdRunState.innerText = "run"; DOM.osdRunState.style.background = 'var(--color-run)'; }
            } else {
                this.classList.add('stopped');
                this.innerText = '▶ 运行';
                if(DOM.osdRunState) { DOM.osdRunState.innerText = "stop"; DOM.osdRunState.style.background = 'var(--color-stop)'; }
            }
        });
    }

    // 视图模式与工具
    if(DOM.btnXy) DOM.btnXy.addEventListener('click', function () { STATE.mode = 'XY'; this.classList.add('active'); DOM.btnDisplay.classList.remove('active'); });
    if(DOM.btnDisplay) DOM.btnDisplay.addEventListener('click', function () { STATE.mode = 'YT'; this.classList.add('active'); DOM.btnXy.classList.remove('active'); });
    if(DOM.btnMeasure) DOM.btnMeasure.addEventListener('click', function () { STATE.measure = !STATE.measure; this.classList.toggle('active'); DOM.measurePanel.style.display = STATE.measure ? 'flex' : 'none'; });
    if(DOM.btnCursors) DOM.btnCursors.addEventListener('click', function () {
        STATE.cursor.mode = (STATE.cursor.mode + 1) % CURSOR.MODE_COUNT;
        this.innerText = ['光标: 关', '光标: Y轴(电压)', '光标: X轴(时间)'][STATE.cursor.mode];
        if (STATE.cursor.mode === 0) this.classList.remove('active'); else this.classList.add('active');
    });

    // 垂直区选择
    if (DOM.verticalChSelect) DOM.verticalChSelect.addEventListener('change', () => refreshVerticalCard(parseInt(DOM.verticalChSelect.value)));
    for (let i = 1; i <= 8; i++) {
        const btn = DOM['ch' + i + 'Toggle'];
        if (btn) btn.addEventListener('click', () => { STATE['ch' + i].on = !STATE['ch' + i].on; refreshVerticalCard(currentSelectedCh); });
    }

    // 垂直/水平/触发旋钮
    if(DOM.btnTrigEn) DOM.btnTrigEn.addEventListener('click', function () {
        STATE.trigger.enabled = !STATE.trigger.enabled;
        if (STATE.trigger.enabled) { this.innerText = '触发: 开'; this.classList.add('active'); } 
        else { this.innerText = '触发: 关'; this.classList.remove('active'); window._frozenTriggerIdx = -1; }
    });
    if (DOM.knobPosSel && DOM.lblPosSel) bindKnob(DOM.knobPosSel, DOM.lblPosSel, null, v => v.toFixed(2), v => { STATE['ch' + currentSelectedCh].pos = v; });
    if (DOM.numScaleSel) DOM.numScaleSel.addEventListener('change', (e) => {
        let v = parseFloat(e.target.value); if (isNaN(v) || v <= 0) v = 0.25;
        e.target.value = v.toFixed(2); STATE['ch' + currentSelectedCh].scale = 1 / v; updateTriggerUI();
    });
    if (DOM.cplChSel) DOM.cplChSel.addEventListener('change', e => { STATE['ch' + currentSelectedCh].cpl = e.target.value; });
    
    if (DOM.btnSelUp && DOM.btnSelDn && DOM.numScaleSel) {
        DOM.btnSelUp.addEventListener('click', () => { let v = parseFloat(DOM.numScaleSel.value) || 0; DOM.numScaleSel.value = (v + GENERATOR_EXT.MIN_SCALE_STEP).toFixed(2); DOM.numScaleSel.dispatchEvent(new Event('change')); });
        DOM.btnSelDn.addEventListener('click', () => { let v = parseFloat(DOM.numScaleSel.value) || 0; if (v > GENERATOR_EXT.MIN_SCALE_STEP) { DOM.numScaleSel.value = (v - GENERATOR_EXT.MIN_SCALE_STEP).toFixed(2); DOM.numScaleSel.dispatchEvent(new Event('change')); } });
    }

    if(DOM.knobHpos) bindKnob(DOM.knobHpos, DOM.lblHpos, null, v => v.toFixed(1) + '%', v => STATE.hpos = v);
    
    // 摇杆式时基控制 - 无上限版，检测边缘停止
    if(DOM.knobTimebase) {
        // 初始化时基值
        if (!STATE.secPerDiv) STATE.secPerDiv = 1.0;
        
        let timebaseInterval = null;
        let currentSliderVal = 0;
        
        // 检测是否到达缓冲区边缘
        const isAtBufferEdge = (direction) => {
            // 获取当前显示范围
            const bufferSize = STATE.current.isSerial ? BUFFER.SERIAL_FFT_SIZE : CONFIG.fftSize;
            const sampleRate = STATE.current.sampleRate || CONFIG.sampleRate;
            const ptsToShow = (STATE.secPerDiv * 10) * (sampleRate / 1000);
            
            // 如果显示点数已经超过缓冲区大小，说明已经显示全部数据
            if (ptsToShow >= bufferSize) {
                return direction > 0; // 放大时停止，缩小可以继续
            }
            
            const startIdxFloat = (STATE.hpos / 100) * (bufferSize - ptsToShow);
            const endIdxFloat = startIdxFloat + ptsToShow;
            
            if (direction > 0) {
                // 放大时检测是否到达缓冲区末尾
                return endIdxFloat >= bufferSize - 10;
            } else {
                // 缩小时检测是否到达最小显示
                return STATE.secPerDiv <= 0.001; // 最小0.001ms
            }
        };
        
        // 开始持续变化
        const startChanging = () => {
            if (timebaseInterval) return;
            
            timebaseInterval = setInterval(() => {
                const sliderVal = currentSliderVal;
                if (Math.abs(sliderVal) < 1) return; // 中心死区
                
                // 检测边缘（注意：现在左拉放大，右拉缩小，所以方向要反向）
                // sliderVal < 0 是左拉（放大），sliderVal > 0 是右拉（缩小）
                if (isAtBufferEdge(sliderVal < 0 ? 1 : -1)) return;
                
                // 拉得越远，变化越快（反向：左拉放大，右拉缩小）
                const offset = Math.abs(sliderVal);
                const change = offset * 0.002;
                
                let currentVal = STATE.secPerDiv || 1.0;
                
                if (sliderVal > 0) {
                    // 右拉：缩小（减少）
                    currentVal -= change * currentVal;
                } else {
                    // 左拉：放大（增加）
                    currentVal += change * currentVal;
                }
                
                // 只限制最小值
                if (currentVal < 0.001) currentVal = 0.001;
                
                STATE.secPerDiv = currentVal;
                
                // 格式化显示
                let displayVal;
                if (currentVal >= 1000) {
                    displayVal = (currentVal / 1000).toFixed(2) + "s";
                } else {
                    displayVal = currentVal.toFixed(2) + "ms";
                }
                if(DOM.lblTimebase) DOM.lblTimebase.innerText = displayVal;
            }, 16);
        };
        
        // 停止变化
        const stopChanging = () => {
            if (timebaseInterval) {
                clearInterval(timebaseInterval);
                timebaseInterval = null;
            }
            if (DOM.knobTimebase) DOM.knobTimebase.value = 0;
            currentSliderVal = 0;
        };
        
        // 鼠标/触摸按下开始
        DOM.knobTimebase.addEventListener('mousedown', startChanging);
        DOM.knobTimebase.addEventListener('touchstart', startChanging);
        
        // 滑块值变化时更新方向
        DOM.knobTimebase.addEventListener('input', (e) => {
            currentSliderVal = parseFloat(e.target.value);
        });
        
        // 鼠标/触摸释放停止
        DOM.knobTimebase.addEventListener('mouseup', stopChanging);
        DOM.knobTimebase.addEventListener('mouseleave', stopChanging);
        DOM.knobTimebase.addEventListener('touchend', stopChanging);
    }

    if(DOM.trigSrc) DOM.trigSrc.addEventListener('change', e => { STATE.trigger.src = e.target.value; if (DOM.osdTriggerSrc) DOM.osdTriggerSrc.innerText = e.target.value; updateTriggerUI(); });
    if(DOM.btnEdge) DOM.btnEdge.addEventListener('click', function () { STATE.trigger.edge *= -1; this.innerText = '边沿: ' + (STATE.trigger.edge === 1 ? '↗ 上升沿' : '↘ 下降沿'); if (DOM.osdTriggerEdge) DOM.osdTriggerEdge.innerText = STATE.trigger.edge === 1 ? '↗' : '↘'; });
    if(DOM.knobTlevel) DOM.knobTlevel.addEventListener('input', (e) => {
        let v = parseFloat(e.target.value); STATE.trigger.level = v;
        if (DOM.lblTlevel) DOM.lblTlevel.innerText = v.toFixed(2) + 'V';
        if (DOM.osdTriggerLevel) DOM.osdTriggerLevel.innerText = v.toFixed(2) + 'V';
    });

    // Autoset 逻辑
    if(DOM.btnAutoset) DOM.btnAutoset.addEventListener('click', () => {
        if (!STATE.run) { showSysModal('提示', '请先运行示波器 (RUN) 以采集数据'); return; }
        // 根据当前模式选择正确的缓冲区大小
        // 音频模式使用FFT_SIZE，串口模式使用SERIAL_FFT_SIZE
        const scanLen = STATE.current.isSerial ? BUFFER.SERIAL_FFT_SIZE : BUFFER.FFT_SIZE;
        const currentRate = (STATE.current && STATE.current.sampleRate) ? STATE.current.sampleRate : CONFIG.sampleRate;

        const analyzeChannel = (rawData) => {
            let max = -999, min = 999, sum = 0, crossings = 0;
            // 遍历整个缓冲区
            for (let i = 0; i < scanLen; i++) {
                let val = rawData[i]; if (val > max) max = val; if (val < min) min = val; sum += val;
            }
            const dcOffset = sum / scanLen; const vpp = max - min;
            let prevVal = rawData[0] - dcOffset;
            for (let i = 1; i < scanLen; i++) {
                let val = rawData[i] - dcOffset; if (prevVal < 0 && val >= 0) crossings++; prevVal = val;
            }
            let freq = crossings > 1 ? (crossings * (currentRate / scanLen)) : 0;
            return { dcOffset, vpp, freq, max, min, valid: vpp > MEASUREMENT.MIN_VALID_VPP }; 
        };

        const stats = Array.from({ length: CHANNEL_COUNT }, (_, i) => analyzeChannel(Buffers['data' + (i + 1)]));
        if (!stats.some(s => s.valid)) return showSysModal('Auto-Set 失败', '所有通道信号均太微弱或无信号，无法自动捕捉');

        let targetVPerDiv = 0.01;
        for (let i = 0; i < CHANNEL_COUNT; i++) { const ch = STATE['ch' + (i + 1)]; if (stats[i].valid && ch.on) targetVPerDiv = Math.max(targetVPerDiv, stats[i].vpp / RENDER_EXT.CYCLE_DISPLAY_FACTOR); }
        let unifiedScale = Math.max(0.01, Math.min(1000, 1.0 / targetVPerDiv));

        for (let i = 0; i < CHANNEL_COUNT; i++) {
            const ch = STATE['ch' + (i + 1)];
            if (stats[i].valid && ch.on) {
                ch.scale = unifiedScale;
                // 计算位置使波形居中：-(max + min) / 2 * scale * NDC_PER_DIV
                // 这样可以将波形的中心线移到屏幕中央
                const centerOffset = (stats[i].max + stats[i].min) / 2;
                ch.pos = -centerOffset * unifiedScale * GRID.NDC_PER_DIV;
            }
        }
        refreshVerticalCard(currentSelectedCh);

        let masterFreq = 0, trigSrc = 'CH1', trigOffset = 0, bestVpp = 0;
        for (let i = 0; i < CHANNEL_COUNT; i++) {
            if (stats[i].valid && STATE['ch' + (i + 1)].on && stats[i].vpp > bestVpp) { 
                bestVpp = stats[i].vpp; 
                masterFreq = stats[i].freq; 
                trigSrc = 'CH' + (i + 1); 
                // 触发level应该设置为波形的中心电压值
                trigOffset = (stats[i].max + stats[i].min) / 2;
            }
        }

        if (masterFreq > 0) {
            let targetSecPerDiv = ((TIMEBASE.MS_TO_S / masterFreq) * 4) / CONFIG.gridX;
            targetSecPerDiv = Math.max(TIMEBASE.MIN_MS, Math.min(TIMEBASE.MAX_MS, targetSecPerDiv));
            STATE.secPerDiv = targetSecPerDiv;
            DOM.knobTimebase.value = targetSecPerDiv;
            if(DOM.lblTimebase) DOM.lblTimebase.innerText = targetSecPerDiv.toFixed(2) + 'ms';
            // osdTimebase 由渲染循环更新
        }

        STATE.trigger.enabled = true; STATE.trigger.src = trigSrc; 
        if(DOM.btnTrigEn) { DOM.btnTrigEn.innerText = '触发: 开'; DOM.btnTrigEn.classList.add('active'); }
        if(DOM.trigSrc) DOM.trigSrc.value = trigSrc; 
        if(DOM.osdTriggerSrc) DOM.osdTriggerSrc.innerText = trigSrc;
        
        // 先更新触发UI以获取正确的范围
        updateTriggerUI();
        
        // 然后设置触发level（确保在新的范围内）
        STATE.trigger.level = trigOffset;
        if(DOM.knobTlevel) DOM.knobTlevel.value = trigOffset; 
        if (DOM.lblTlevel) DOM.lblTlevel.innerText = trigOffset.toFixed(2) + 'V';
        
        DOM.knobTimebase.dispatchEvent(new Event('input'));
    });

    // 交互拖拽 (Canvas)
    const getNDC = (e) => {
        const rect = DOM.glCanvas.getBoundingClientRect(); 
        let cX = e.clientX, cY = e.clientY;
        if (e.touches && e.touches.length > 0) { cX = e.touches[0].clientX; cY = e.touches[0].clientY; }
        return { x: (cX - rect.left) / rect.width * 2.0 - 1.0, y: -((cY - rect.top) / rect.height * 2.0 - 1.0) };
    };

    const startCursorDrag = (e) => {
        if (STATE.cursor.mode === 0) return;
        const { x, y } = getNDC(e); const thr = CURSOR.DRAG_THRESHOLD;
        if (STATE.cursor.mode === 1) { 
            if (Math.abs(y - STATE.cursor.v1) < thr) STATE.cursor.dragging = 'v1'; 
            else if (Math.abs(y - STATE.cursor.v2) < thr) STATE.cursor.dragging = 'v2'; 
        } else if (STATE.cursor.mode === 2) { 
            if (Math.abs(x - STATE.cursor.t1) < thr) STATE.cursor.dragging = 't1'; 
            else if (Math.abs(x - STATE.cursor.t2) < thr) STATE.cursor.dragging = 't2'; 
        }
    };

    const doCursorDrag = (e) => {
        if (!STATE.cursor.dragging) return; 
        e.preventDefault(); const { x, y } = getNDC(e);
        if (STATE.cursor.dragging.startsWith('v')) STATE.cursor[STATE.cursor.dragging] = Math.max(-1, Math.min(1, y)); 
        else STATE.cursor[STATE.cursor.dragging] = Math.max(-1, Math.min(1, x)); 
    };
    const endCursorDrag = () => { STATE.cursor.dragging = null; };

    if (DOM.glCanvas) {
        DOM.glCanvas.addEventListener('mousemove', (e) => {
            const rect = DOM.glCanvas.getBoundingClientRect();
            if (STATE.cursor.dragging) { STATE.hover.active = false; return; }
            STATE.hover.x = e.clientX - rect.left; STATE.hover.y = e.clientY - rect.top; STATE.hover.active = true;
        });
        DOM.glCanvas.addEventListener('mouseleave', () => { STATE.hover.active = false; });
        DOM.glCanvas.addEventListener('mousedown', startCursorDrag); 
        DOM.glCanvas.addEventListener('touchstart', startCursorDrag, { passive: true }); 
    }
    window.addEventListener('mousemove', doCursorDrag, { passive: false }); 
    window.addEventListener('mouseup', endCursorDrag);
    window.addEventListener('touchmove', doCursorDrag, { passive: false }); 
    window.addEventListener('touchend', endCursorDrag);
}