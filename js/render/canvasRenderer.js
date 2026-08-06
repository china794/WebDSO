/**
 * ==========================================
 * Canvas Renderer - Canvas 2D 叠加层渲染器
 * ==========================================
 * 负责使用 Canvas 2D 渲染叠加层（网格、光标、文字等）
 */

import { STATE, CONFIG, Buffers, CHANNEL_COUNT } from '../core.js';
import { TIMEBASE, BUFFER, GRID, CURSOR } from '../constants.js';
import { findTriggerIndex } from '../signal.js';

/**
 * ==========================================
 * Canvas 渲染辅助子模块
 * 负责时基、触发点、视图窗口的参数计算
 * ==========================================
 */

export function calculateTimebaseAndTrigger(w) {
    let currentRate = STATE.current.sampleRate;

    // 根据当前模式选择缓冲区大小
    const bufferSize = STATE.current.isSerial ? BUFFER.SERIAL_FFT_SIZE : BUFFER.FFT_SIZE;

    // 计算每个网格代表的采样点数
    let ptsPerDiv = (STATE.secPerDiv) * (currentRate / TIMEBASE.KILO_DIVISOR);
    // 限制 ptsToShow 不超过数据缓冲区大小，防止大 sec/div 时波形消失；
    // 至少为 1，避免低采样率下 ptsToShow=0 导致除零
    let ptsToShow = Math.max(1, Math.min(Math.floor(ptsPerDiv * CONFIG.gridX), bufferSize));

    // 触发源通道解析：钳制到 1-8，防御损坏配置（如 "CH9"/"CHX"）导致越界崩溃
    const trigChRaw = parseInt(String(STATE.trigger.src || '').replace('CH', ''), 10);
    const trigCh = (Number.isFinite(trigChRaw) && trigChRaw >= 1 && trigChRaw <= CHANNEL_COUNT) ? trigChRaw : 1;
    const chState = STATE['ch' + trigCh];
    let trigData = Buffers['pData' + trigCh] || Buffers.pData1;
    let tScale = (chState && chState.scale) ? chState.scale : 1;
    let tPos = (chState && chState.pos) ? chState.pos : 0;

    // 将触发电平映射到波形数据的值域
    let mappedLevel = STATE.trigger.level * tScale * GRID.NDC_PER_DIV + tPos;

    if (STATE.trigger.enabled) {
        if (!STATE.trigger.frozenIdx || STATE.run) {
            STATE.trigger.frozenIdx = findTriggerIndex(trigData, ptsToShow, 0, mappedLevel);
        }
    } else {
        STATE.trigger.frozenIdx = -1;
    }

    let triggerIndexFloat = STATE.trigger.frozenIdx;
    
    // 计算视图的锚点和中心
    let anchorIdx = triggerIndexFloat !== -1 ? triggerIndexFloat : bufferSize / 2;
    let viewCenterIdx = anchorIdx + (STATE.hpos / CURSOR.HPOS_NORM - 0.5) * bufferSize;
    
    // 计算渲染的起止索引
    let startIdxFloat = viewCenterIdx - ptsToShow / 2;
    let startIdxInt = Math.floor(startIdxFloat);
    let endIdxInt = Math.ceil(startIdxFloat + ptsToShow) + 1;

    return { 
        ptsToShow, 
        mappedLevel, 
        triggerIndexFloat, 
        anchorIdx, 
        startIdxFloat, 
        startIdxInt, 
        endIdxInt 
    };
}