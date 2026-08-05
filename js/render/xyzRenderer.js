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
    let { yaw, pitch, zoom, perspective } = v3d;
    if (!zoom) zoom = 1;
    if (!perspective) perspective = 3;

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

    let rx = x * cosY + z * sinY;
    let ry = y;
    let rz = -x * sinY + z * cosY;

    let rx2 = rx;
    let ry2 = ry * cosP - rz * sinP;
    let rz2 = ry * sinP + rz * cosP;

    const d = perspective * zoom;
    const w = d + rz2;
    // 近裁剪: 点在相机后方 (w <= NEAR) 剔除, 防止投影翻转
    if (w <= NEAR) return null;

    // 深度归一化: 用相机空间 z (rz2) 相对透视距离 d 映射到 [0,1]。
    // rz2 ∈ [-1,1] 时, depth = (rz2 + 1) / 2, 近处 (负 z 朝相机) 0, 远处 (正 z) 1。
    // 随 zoom 缩放透视距离 d 一起变化, 保证深度层次明显。
    const depth = Math.max(0, Math.min(1, (rz2 + d) / (2 * d)));

    return { sx: rx2 * d / w, sy: ry2 * d / w, depth };
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
 * 绘制 3D 边界线框 + 坐标轴 (带深度感知: 近处粗亮, 远处细暗)
 */
export function renderXYZAxes(w, h, theme) {
    if (!ctx2d) return;
    const v3d = STATE.view3d;
    const cx = v3d.cageX || 0.5;
    const cy = v3d.cageY || 0.5;
    const cz = v3d.cageZ || 0.5;

    // 8 个顶点: (±cx, ±cy, ±cz) — 可能被近裁剪剔除 (返回 null)
    const coords = [
        [-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],
        [-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]
    ];
    const verts = coords.map(c => {
        const p = projectPoint(c[0]*cx, c[1]*cy, c[2]*cz, v3d);
        if (!p) return null;
        return {
            x: (p.sx * 0.5 + 0.5) * w,
            y: (-p.sy * 0.5 + 0.5) * h,
            depth: p.depth
        };
    });

    // 12 条边 (跳过含被裁剪顶点的边)
    const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];

    ctx2d.save();

    // 线框: 深度感知 (近粗远细)
    for (const [i,j] of edges) {
        const vi = verts[i], vj = verts[j];
        if (!vi || !vj) continue;
        const avgDepth = (vi.depth + vj.depth) / 2;
        // 深度衰减: 近处 (depth≈0) 线宽 1, 远处 (depth≈1) 线宽 0.3
        const width = 1.0 - avgDepth * 0.7;
        const alpha = 0.5 - avgDepth * 0.35;
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
    const ox = (origin.sx * 0.5 + 0.5) * w;
    const oy = (-origin.sy * 0.5 + 0.5) * h;

    const axisLen = 1.3;
    const axes = [
        { x: cx*axisLen, y: 0, z: 0, label: 'X', color: theme.c1 || '#FF3B30' },
        { x: 0, y: cy*axisLen, z: 0, label: 'Y', color: theme.c2 || '#007AFF' },
        { x: 0, y: 0, z: cz*axisLen, label: 'Z', color: theme.c3 || '#4CD964' },
    ];

    for (const ax of axes) {
        const end = projectPoint(ax.x, ax.y, ax.z, v3d);
        if (!end) continue;
        const ex = (end.sx * 0.5 + 0.5) * w;
        const ey = (-end.sy * 0.5 + 0.5) * h;
        ctx2d.strokeStyle = ax.color;
        ctx2d.lineWidth = 1.5;
        ctx2d.beginPath();
        ctx2d.moveTo(ox, oy);
        ctx2d.lineTo(ex, ey);
        ctx2d.stroke();
        ctx2d.fillStyle = ax.color;
        ctx2d.font = 'bold 12px monospace';
        ctx2d.fillText(ax.label, ex + 4, ey + 4);
    }

    ctx2d.restore();
}
