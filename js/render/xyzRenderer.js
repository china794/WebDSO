/**
 * ==========================================
 * XYZ 3D 投影模块
 * ==========================================
 * 将 CH1(X)/CH2(Y)/CH3(Z) 通过旋转+透视投影转换为 2D 坐标
 * 绘制 3D 边界线框和坐标轴
 */

import { STATE } from '../core.js';
import { ctx2d } from './context.js';

// 透视近裁剪面 (相机后方剔除, 防止点翻转)
const NEAR = 0.1;

/**
 * 3D 点投影到 2D 屏幕坐标 (NDC), 同时保留相机空间深度。
 * @returns {null|{sx:number, sy:number, depth:number}}
 *          depth: 相机空间深度 (0=近, 越大越远), 用于深度感知渲染
 *          点在近裁剪面后方返回 null (剔除, 避免翻转)
 */
function projectPoint(x, y, z, v3d) {
    let { yaw, pitch, perspective } = v3d;
    if (!perspective) perspective = 3;

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

    // 世界 → 相机空间旋转
    let rx = x * cosY + z * sinY;
    let ry = y;
    let rz = -x * sinY + z * cosY;

    // 俯仰旋转
    let rx2 = rx;
    let ry2 = ry * cosP - rz * sinP;
    let rz2 = ry * sinP + rz * cosP;

    // 纯透视投影 (zoom 由 computeViewTransform 作为视口缩放, 不在这里乘 d)
    const d = perspective;
    const w = d + rz2;
    // 近裁剪: 点在相机后方 (w <= NEAR) 剔除, 防止投影翻转
    if (w <= NEAR) return null;

    // 深度归一化: 相机空间 z (rz2) 映射到 [0,1], 近处 0, 远处 1
    const depth = Math.max(0, Math.min(1, (rz2 + d) / (2 * d)));

    return { sx: rx2 * d / w, sy: ry2 * d / w, depth, rz: rz2 };
}

/**
 * 投影 X/Y/Z 三通道数据到 2D, 保留深度。
 * @returns {null|{xArr:Float32Array, yArr:Float32Array, depthArr:Float32Array, length:number}}
 *          被近裁剪剔除的点深度置 1 (最远), 由渲染层跳过
 */
export function projectXYZ(xData, yData, zData) {
    const len = Math.min(xData.length, yData.length, zData.length);
    if (len < 2) return null;

    const v3d = STATE.view3d;
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < len; i++) {
        const v = zData[i];
        if (v < zMin) zMin = v;
        if (v > zMax) zMax = v;
    }
    const zRange = zMax - zMin || 1;

    const xArr = new Float32Array(len);
    const yArr = new Float32Array(len);
    const depthArr = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        const zNorm = (zData[i] - zMin) / zRange * 2 - 1;
        const p = projectPoint(xData[i], yData[i], zNorm, v3d);
        if (p) {
            xArr[i] = p.sx;
            yArr[i] = p.sy;
            depthArr[i] = p.depth;
        } else {
            // 剔除点: 置为最远深度, 渲染层跳过 (x/y 置 0 仅作占位)
            xArr[i] = 0;
            yArr[i] = 0;
            depthArr[i] = 1;
        }
    }
    return { xArr, yArr, depthArr, length: len };
}

/**
 * 计算统一的 3D 视口变换 (scale + 居中), 波形和线框共用, 保证对齐。
 * 基于投影点的实际范围自动适配 (填屏 ~80%), zoom 作为视口缩放叠加。
 * @param {object} proj - projectXYZ 的返回值
 * @param {number} zoom - 视口缩放 (默认 view3d.zoom)
 * @returns {{scale:number, offsetX:number, offsetY:number, valid:boolean}}
 */
export function computeViewTransform(proj, zoom) {
    if (!proj || proj.length < 4) return { scale: 1, offsetX: 0, offsetY: 0, valid: false };

    // 固定视口变换: offset 始终居中到屏幕中心 (0), 不跟随波形极值。
    // 波形数据已在渲染层去均值 (AC 耦合), 自然居中。
    // 这保证视角稳定, 不随波形数据滚动而抖动/漂移 (抽搐根因)。
    //
    // scale 用固定基准 (基于典型 NDC 投影范围 ±1.5 填屏 ~85%):
    // 避免自动适配导致 scale 每帧跟随波形范围变化。
    const baseScale = 0.85 / 1.5;
    const scale = baseScale * (zoom || 1);

    return { scale, offsetX: 0, offsetY: 0, valid: true };
}

/**
 * 应用视口变换到投影坐标。
 * @param {number} sx - 投影 NDC x
 * @param {number} sy - 投影 NDC y
 * @param {object} t - computeViewTransform 的返回值
 * @returns {[number, number]} 变换后的 NDC
 */
export function applyViewTransform(sx, sy, t) {
    return [ (sx - t.offsetX) * t.scale, (sy - t.offsetY) * t.scale ];
}

/**
 * 绘制 3D 边界线框 + 坐标轴 (带深度感知: 近处粗亮, 远处细暗)
 * @param {number} w - 画布宽 (CSS 像素)
 * @param {number} h - 画布高
 * @param {object} theme - 主题色
 * @param {object} transform - computeViewTransform 返回值, 与波形共用保证对齐
 */
export function renderXYZAxes(w, h, theme, transform) {
    if (!ctx2d) return;
    const v3d = STATE.view3d;
    // cage 半尺寸默认 ±1 (匹配波形数据 NDC 范围), 可用 cageX/Y/Z 微调
    const cx = v3d.cageX || 1;
    const cy = v3d.cageY || 1;
    const cz = v3d.cageZ || 1;

    // 应用视口变换: 投影 NDC → (sx-offsetX)*scale → 屏幕像素
    const toScreen = (sx, sy) => {
        const [x, y] = applyViewTransform(sx, sy, transform);
        return { x: (x * 0.5 + 0.5) * w, y: (-y * 0.5 + 0.5) * h };
    };

    // 8 个 cage 顶点: (±cx, ±cy, ±cz) — 可能被近裁剪剔除 (返回 null)
    const coords = [
        [-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],
        [-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]
    ];
    const verts = coords.map(c => {
        const p = projectPoint(c[0]*cx, c[1]*cy, c[2]*cz, v3d);
        if (!p) return null;
        const s = toScreen(p.sx, p.sy);
        return { x: s.x, y: s.y, depth: p.depth };
    });

    // 12 条边 (跳过含被裁剪顶点的边)
    const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];

    ctx2d.save();

    // 线框: 深度感知 (近粗远细)
    for (const [i,j] of edges) {
        const vi = verts[i], vj = verts[j];
        if (!vi || !vj) continue;
        const avgDepth = (vi.depth + vj.depth) / 2;
        // 深度衰减: 近处 (depth≈0) 线宽 1.2, 远处 (depth≈1) 线宽 0.4
        const width = 1.2 - avgDepth * 0.8;
        const alpha = 0.45 - avgDepth * 0.25;
        ctx2d.strokeStyle = theme.grid || 'rgba(120,120,120,' + alpha + ')';
        ctx2d.lineWidth = width;
        ctx2d.beginPath();
        ctx2d.moveTo(vi.x, vi.y);
        ctx2d.lineTo(vj.x, vj.y);
        ctx2d.stroke();
    }

    // 坐标轴 (跳过被裁剪的原点)
    const origin = projectPoint(0, 0, 0, v3d);
    if (!origin) { ctx2d.restore(); return; }
    const os = toScreen(origin.sx, origin.sy);

    const axisLen = 1.3;
    const axes = [
        { x: cx*axisLen, y: 0, z: 0, label: 'X', color: theme.c1 || '#FF3B30' },
        { x: 0, y: cy*axisLen, z: 0, label: 'Y', color: theme.c2 || '#007AFF' },
        { x: 0, y: 0, z: cz*axisLen, label: 'Z', color: theme.c3 || '#4CD964' },
    ];

    for (const ax of axes) {
        const end = projectPoint(ax.x, ax.y, ax.z, v3d);
        if (!end) continue;
        const es = toScreen(end.sx, end.sy);
        ctx2d.strokeStyle = ax.color;
        ctx2d.lineWidth = 1.5;
        ctx2d.beginPath();
        ctx2d.moveTo(os.x, os.y);
        ctx2d.lineTo(es.x, es.y);
        ctx2d.stroke();
        ctx2d.fillStyle = ax.color;
        ctx2d.font = 'bold 12px monospace';
        ctx2d.fillText(ax.label, es.x + 4, es.y + 4);
    }

    ctx2d.restore();
}
