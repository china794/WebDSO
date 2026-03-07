/**
 * ==========================================
 * Cursor Renderer - 光标渲染器
 * ==========================================
 * 负责绘制光标线和测量信息
 */

// TODO: 实现电压光标线绘制
// TODO: 实现时间光标线绘制
// TODO: 实现光标测量值显示
// TODO: 实现光标拖拽交互
// js/render/cursorRenderer.js
import { STATE, CONFIG, CHANNEL_COUNT, DOM, Buffers } from '../core.js';
import { GRID, UI, TIMEBASE, BUFFER } from '../constants.js';
import { ctx2d } from './index.js';

/**
 * ==========================================
 * 辅助 UI 渲染子模块
 * 负责绘制触发线、小地图、测量光标与悬停信息框
 * ==========================================
 */

/** 绘制触发电平虚线及触发点位置 */
export function renderTriggerLine(w, h, theme, viewCtx) {
    if (!ctx2d) return;
    if (STATE.mode === 'YT' && STATE.trigger.enabled) {
        ctx2d.save();
        ctx2d.strokeStyle = theme.trigger;
        ctx2d.setLineDash([4, 4]);
        ctx2d.beginPath();
        
        let ty = h / 2 - viewCtx.mappedLevel * (h / 2);
        ctx2d.moveTo(0, ty); 
        ctx2d.lineTo(w, ty);
        ctx2d.stroke();
        
        if (viewCtx.triggerIndexFloat !== -1) {
            let tx = ((viewCtx.triggerIndexFloat - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * w;
            if (tx >= 0 && tx <= w) { 
                ctx2d.beginPath(); 
                ctx2d.moveTo(tx, 0); 
                ctx2d.lineTo(tx, h); 
                ctx2d.stroke(); 
            }
        }
        ctx2d.setLineDash([]);
        ctx2d.restore();
    }
}

/** 绘制全局波形小地图及当前视图高亮框 */
export function renderMinimap(theme, viewCtx) {
    const minimapCanvas = DOM.minimapCanvas;
    if (!minimapCanvas) return;
    
    if (minimapCanvas.width === 0 || minimapCanvas.width !== minimapCanvas.clientWidth) {
        minimapCanvas.width = minimapCanvas.clientWidth;
        minimapCanvas.height = minimapCanvas.clientHeight;
    }
    const mCtx = minimapCanvas.getContext('2d');
    const mW = minimapCanvas.width;
    const mH = minimapCanvas.height;
    
    mCtx.clearRect(0, 0, mW, mH);
    mCtx.lineWidth = 1;
    mCtx.globalCompositeOperation = 'lighter'; 

    // 根据当前模式选择缓冲区大小
    const bufferSize = STATE.current.isSerial ? BUFFER.SERIAL_FFT_SIZE : CONFIG.fftSize;

    // 性能优化：小地图降采样缓存
    // 每帧只渲染固定数量的点，不随缓冲区大小变化
    const MINIMAP_POINTS = 200; // 小地图固定渲染200个点
    const step = bufferSize / MINIMAP_POINTS;

    // 使用缓存的降采样数据，避免每帧重复计算
    // 限制缓存大小以防止内存泄漏
    if (!window._minimapCache) window._minimapCache = {};
    if (!window._minimapCache.lastBufferSize) window._minimapCache.lastBufferSize = 0;
    if (!window._minimapCache.lastHead) window._minimapCache.lastHead = -1;
    
    // 清理过期缓存（保留最近10个版本）
    if (window._minimapCache.data) {
        const keys = Object.keys(window._minimapCache.data);
        if (keys.length > 10) {
            keys.slice(0, keys.length - 10).forEach(k => delete window._minimapCache.data[k]);
        }
    }

    // 检查是否需要重新计算降采样数据
    // 使用简单的时间戳来判断数据是否变化（每100ms更新一次）
    const currentTime = Date.now();
    const currentDataVersion = Math.floor(currentTime / 100); // 每100ms一个版本
    const needUpdate = window._minimapCache.lastBufferSize !== bufferSize ||
                       window._minimapCache.lastDataVersion !== currentDataVersion;

    if (needUpdate) {
        window._minimapCache.lastBufferSize = bufferSize;
        window._minimapCache.lastDataVersion = currentDataVersion;
        window._minimapCache.data = {};
    }

    const drawMiniTrace = (data, color, chIdx) => {
        mCtx.strokeStyle = color;
        mCtx.beginPath();
        let started = false;

        // 获取或计算降采样数据
        let miniData;
        if (!needUpdate && window._minimapCache.data[chIdx]) {
            miniData = window._minimapCache.data[chIdx];
        } else {
            miniData = new Float32Array(MINIMAP_POINTS * 2); // min, max交替存储

            for (let i = 0; i < MINIMAP_POINTS; i++) {
                let start = Math.floor(i * step);
                let end = Math.floor((i + 1) * step);
                let min = data[start], max = data[start];

                // 手动展开循环，提高性能
                for (let j = start + 1; j < end; j += 4) {
                    let v0 = data[j];
                    let v1 = data[j + 1] || v0;
                    let v2 = data[j + 2] || v0;
                    let v3 = data[j + 3] || v0;

                    if (v0 < min) min = v0;
                    if (v0 > max) max = v0;
                    if (v1 < min) min = v1;
                    if (v1 > max) max = v1;
                    if (v2 < min) min = v2;
                    if (v2 > max) max = v2;
                    if (v3 < min) min = v3;
                    if (v3 > max) max = v3;
                }

                miniData[i * 2] = min;
                miniData[i * 2 + 1] = max;
            }

            window._minimapCache.data[chIdx] = miniData;
        }

        // 渲染缓存的降采样数据
        const xScale = mW / MINIMAP_POINTS;
        for (let i = 0; i < MINIMAP_POINTS; i++) {
            let min = miniData[i * 2];
            let max = miniData[i * 2 + 1];
            let x = i * xScale;
            let yB = mH / 2 - min * (mH / 2);
            let yT = mH / 2 - max * (mH / 2);

            if (!started) {
                mCtx.moveTo(x, yB);
                started = true;
            }
            mCtx.lineTo(x, yB);
            mCtx.lineTo(x, yT);
        }
        mCtx.stroke();
    };

    for (let i = 1; i <= CHANNEL_COUNT; i++) {
        if (STATE['ch' + i].on) {
            drawMiniTrace(Buffers['pData' + i], theme['miniTrace' + i], i);
        }
    }

    mCtx.globalCompositeOperation = 'source-over';

    // 更新高亮视窗框的位置和宽度
    let leftP = (viewCtx.startIdxFloat / bufferSize) * 100;
    let widthP = (viewCtx.ptsToShow / bufferSize) * 100;
    if (DOM.minimapHighlight) { 
        DOM.minimapHighlight.style.left = leftP + '%'; 
        DOM.minimapHighlight.style.width = widthP + '%'; 
    }
}

/** 绘制 X / Y 轴测量光标及数据面板 */
export function renderCursors(w, h, theme) {
    if (!ctx2d) return;
    if (!STATE.cursor || STATE.cursor.mode <= 0) return;
    
    ctx2d.save(); 
    ctx2d.translate(0.5, 0.5); 
    ctx2d.lineWidth = 1;

    // Y 轴电压光标
    if (STATE.cursor.mode === 1) {
        let y1 = h / 2 - STATE.cursor.v1 * (h / 2);
        let y2 = h / 2 - STATE.cursor.v2 * (h / 2);
        
        ctx2d.strokeStyle = theme.cursorY;
        ctx2d.setLineDash([4, 4]); 
        ctx2d.beginPath(); ctx2d.moveTo(0, y1); ctx2d.lineTo(w, y1); ctx2d.stroke();
        ctx2d.beginPath(); ctx2d.moveTo(0, y2); ctx2d.lineTo(w, y2); ctx2d.stroke();
        
        const dvVals = Array.from({ length: CHANNEL_COUNT }, (_, i) => 
            STATE['ch' + (i + 1)].on ? Math.abs(STATE.cursor.v1 - STATE.cursor.v2) / GRID.NDC_PER_DIV * (1 / STATE['ch' + (i + 1)].scale) : null
        );
        
        const panelHeight = Math.max(UI.CURSOR_PANEL_MIN_HEIGHT, UI.CURSOR_PANEL_PADDING + dvVals.filter(Boolean).length * UI.CURSOR_PANEL_ROW_HEIGHT);
        
        ctx2d.fillStyle = theme.hoverBg;
        ctx2d.fillRect(10, 40, UI.CURSOR_PANEL_WIDTH, panelHeight);
        ctx2d.strokeStyle = theme.hoverBorder;
        ctx2d.setLineDash([]);
        ctx2d.strokeRect(10, 40, UI.CURSOR_PANEL_WIDTH, panelHeight);

        ctx2d.font = 'bold 11px Courier New';
        let dy = 58;
        for (let i = 0; i < CHANNEL_COUNT; i++) {
            if (dvVals[i] != null) {
                ctx2d.fillStyle = theme['c' + (i + 1) + 'Hex'];
                ctx2d.fillText(`ΔCH${i + 1}: ${dvVals[i].toFixed(2)} V`, 20, dy);
                dy += UI.CURSOR_PANEL_ROW_HEIGHT;
            }
        }
    } 
    // X 轴时间光标
    else if (STATE.cursor.mode === 2) {
        let x1 = w / 2 + STATE.cursor.t1 * (w / 2);
        let x2 = w / 2 + STATE.cursor.t2 * (w / 2);
        
        ctx2d.strokeStyle = theme.cursorX;
        ctx2d.setLineDash([4, 4]); 
        ctx2d.beginPath(); ctx2d.moveTo(x1, 0); ctx2d.lineTo(x1, h); ctx2d.stroke();
        ctx2d.beginPath(); ctx2d.moveTo(x2, 0); ctx2d.lineTo(x2, h); ctx2d.stroke();
        
        let dt = Math.abs(STATE.cursor.t1 - STATE.cursor.t2) / (2.0 / CONFIG.gridX) * STATE.secPerDiv;
        let f = dt > 0 ? TIMEBASE.MS_TO_S / dt : 0;
        
        ctx2d.fillStyle = theme.hoverBg;
        ctx2d.fillRect(10, 40, UI.CURSOR_TIME_PANEL_WIDTH, UI.CURSOR_TIME_PANEL_HEIGHT);
        ctx2d.strokeStyle = theme.hoverBorder;
        ctx2d.setLineDash([]);
        ctx2d.strokeRect(10, 40, UI.CURSOR_TIME_PANEL_WIDTH, UI.CURSOR_TIME_PANEL_HEIGHT); 
        
        ctx2d.fillStyle = theme.cursorX; 
        ctx2d.font = 'bold 12px Courier New'; 
        ctx2d.fillText(`ΔT : ${dt.toFixed(2)} ms`, 20, 60); 
        ctx2d.fillText(`1/ΔT: ${f.toFixed(1)} Hz`, 20, 80);
    }
    ctx2d.restore();
}

/** 绘制鼠标悬停时的十字准星及详细读数 */
export function renderHover(w, h, stepX, theme, viewCtx) {
    if (!ctx2d) return;
    if (!STATE.hover || !STATE.hover.active || STATE.mode !== 'YT') return;
    
    ctx2d.save();
    ctx2d.strokeStyle = theme.fftTextDim;
    ctx2d.lineWidth = 1; 
    ctx2d.setLineDash([4, 4]);
    ctx2d.beginPath(); 
    ctx2d.moveTo(STATE.hover.x, 0); 
    ctx2d.lineTo(STATE.hover.x, h); 
    ctx2d.moveTo(0, STATE.hover.y); 
    ctx2d.lineTo(w, STATE.hover.y); 
    ctx2d.stroke();
    
    let tx = ((viewCtx.anchorIdx - viewCtx.startIdxFloat) / viewCtx.ptsToShow) * w;
    let gX = (STATE.hover.x - tx) / stepX; 
    let tD = gX * STATE.secPerDiv;
    let vNDC = (h / 2 - STATE.hover.y) / (h / 2); 
    
    const vVals = Array.from({ length: CHANNEL_COUNT }, (_, i) => 
        STATE['ch' + (i + 1)].on ? (vNDC - STATE['ch' + (i + 1)].pos) / (STATE['ch' + (i + 1)].scale * GRID.NDC_PER_DIV) : null
    );
    
    let bW = 140, bH = Math.max(65, 20 + vVals.filter(Boolean).length * 18);
    let tX = STATE.hover.x + 15, tY = STATE.hover.y + 15;
    
    // 防止面板超出画布边界
    if (tX + bW > w) tX = STATE.hover.x - bW - 10; 
    if (tY + bH > h) tY = STATE.hover.y - bH - 10;
    
    ctx2d.fillStyle = theme.hoverBg; 
    ctx2d.fillRect(tX, tY, bW, bH); 
    ctx2d.strokeStyle = theme.hoverBorder; 
    ctx2d.setLineDash([]); 
    ctx2d.strokeRect(tX, tY, bW, bH);
    
    ctx2d.font = 'bold 12px Courier New'; 
    ctx2d.fillStyle = theme.hoverText; 
    ctx2d.fillText(` T: ${tD > 0 ? '+' : ''}${tD.toFixed(3)} ms`, tX + 10, tY + 20);
    
    let vy = tY + 38;
    for (let i = 0; i < CHANNEL_COUNT; i++) {
        if (vVals[i] != null) {
            ctx2d.fillStyle = theme['c' + (i + 1) + 'Hex'];
            ctx2d.fillText(`C${i + 1}: ${vVals[i].toFixed(3)} V`, tX + 10, vy);
            vy += 18;
        }
    }
    ctx2d.restore();
}