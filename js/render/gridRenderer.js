/**
 * ==========================================
 * Grid Renderer - 网格渲染器
 * ==========================================
 * 负责绘制示波器网格背景
 */

// TODO: 实现网格线绘制
// TODO: 实现刻度标记绘制
// TODO: 实现中心十字准星绘制
// js/render/webglRenderer.js
// js/render/gridRenderer.js
import { CONFIG } from '../core.js';
import { RENDER } from '../constants.js';
import { ctx2d } from './index.js';

/**
 * ==========================================
 * Canvas 网格渲染子模块
 * 负责绘制背景网格和中心十字标尺刻度
 * ==========================================
 */

export function renderGrid(w, h, stepX, stepY, theme) {
    if (!ctx2d) return;

    ctx2d.save();
    // 像素对齐偏移，防止 1px 线条模糊
    ctx2d.translate(RENDER.CANVAS_PIXEL_OFFSET, RENDER.CANVAS_PIXEL_OFFSET);
    
    // ================== 背景网格线 ==================
    ctx2d.strokeStyle = theme.grid;
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    
    // 垂直网格线 (从中心向两侧扩散)
    for (let x = w / 2 + stepX; x < w; x += stepX) { ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); }
    for (let x = w / 2 - stepX; x > 0; x -= stepX) { ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); }
    
    // 水平网格线
    for (let i = 1; i < CONFIG.gridY; i++) { ctx2d.moveTo(0, i * stepY); ctx2d.lineTo(w, i * stepY); }
    ctx2d.stroke();

    // ================== 十字标尺与细分刻度 ==================
    ctx2d.strokeStyle = theme.crosshair;
    ctx2d.beginPath();
    
    // 中心主轴
    ctx2d.moveTo(w / 2, 0); ctx2d.lineTo(w / 2, h);
    ctx2d.moveTo(0, h / 2); ctx2d.lineTo(w, h / 2);

    // X 轴上的细分小刻度 (每格分5份)
    for (let x = w / 2 + stepX / 5; x < w; x += stepX / 5) { 
        ctx2d.moveTo(x, h / 2 - RENDER.CROSSHAIR_TICK_LEN); 
        ctx2d.lineTo(x, h / 2 + RENDER.CROSSHAIR_TICK_LEN); 
    }
    for (let x = w / 2 - stepX / 5; x > 0; x -= stepX / 5) { 
        ctx2d.moveTo(x, h / 2 - RENDER.CROSSHAIR_TICK_LEN); 
        ctx2d.lineTo(x, h / 2 + RENDER.CROSSHAIR_TICK_LEN); 
    }
    
    // Y 轴上的细分小刻度 (每格分5份)
    for (let y = h / 2 + stepY / 5; y < h; y += stepY / 5) { 
        ctx2d.moveTo(w / 2 - RENDER.CROSSHAIR_TICK_LEN, y); 
        ctx2d.lineTo(w / 2 + RENDER.CROSSHAIR_TICK_LEN, y); 
    }
    for (let y = h / 2 - stepY / 5; y > 0; y -= stepY / 5) { 
        ctx2d.moveTo(w / 2 - RENDER.CROSSHAIR_TICK_LEN, y); 
        ctx2d.lineTo(w / 2 + RENDER.CROSSHAIR_TICK_LEN, y); 
    }
    
    ctx2d.stroke();
    ctx2d.restore();
}