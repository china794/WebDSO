/**
 * ==========================================
 * XYZ 3D 投影模块
 * ==========================================
 * 将 CH1(X)/CH2(Y)/CH3(Z) 通过旋转+透视投影转换为 2D 坐标
 * 绘制 3D 边界线框和坐标轴
 */

import { STATE } from '../core.js';
import { ctx2d } from './context.js';

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
    if (Math.abs(w) < 0.001) return { sx: 0, sy: 0 };

    return { sx: rx2 * d / w, sy: ry2 * d / w };
}

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
    for (let i = 0; i < len; i++) {
        const zNorm = (zData[i] - zMin) / zRange * 2 - 1;
        const p = projectPoint(xData[i], yData[i], zNorm, v3d);
        xArr[i] = p.sx;
        yArr[i] = p.sy;
    }
    return { xArr, yArr, length: len };
}

/**
 * 绘制 3D 边界线框 + 坐标轴
 */
export function renderXYZAxes(w, h, theme) {
    if (!ctx2d) return;
    const v3d = STATE.view3d;
    const cx = v3d.cageX || 0.5;
    const cy = v3d.cageY || 0.5;
    const cz = v3d.cageZ || 0.5;

    // 8 个顶点: (±cx, ±cy, ±cz)
    const coords = [
        [-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],
        [-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]
    ];
    const verts = coords.map(c => {
        const p = projectPoint(c[0]*cx, c[1]*cy, c[2]*cz, v3d);
        return { x: (p.sx * 0.5 + 0.5) * w, y: (-p.sy * 0.5 + 0.5) * h };
    });

    // 12 条边
    const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];

    ctx2d.save();

    // 线框
    ctx2d.strokeStyle = theme.grid || 'rgba(120,120,120,0.3)';
    ctx2d.lineWidth = 0.5;
    for (const [i,j] of edges) {
        ctx2d.beginPath();
        ctx2d.moveTo(verts[i].x, verts[i].y);
        ctx2d.lineTo(verts[j].x, verts[j].y);
        ctx2d.stroke();
    }

    // 坐标轴标签
    const origin = projectPoint(0, 0, 0, v3d);
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
