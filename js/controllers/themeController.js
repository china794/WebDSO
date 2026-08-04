/**
 * ==========================================
 * Theme Controller - 主题切换控制器
 * ==========================================
 * 支持深色/浅色/经典绿/琥珀 预设主题
 */

import { THEME } from '../constants.js';

/** 可选主题列表 */
const THEMES = ['dark', 'light', 'green', 'amber'];

export function initThemeController() {
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const themeIconPath = document.getElementById('theme-icon-path');
    const themePreset = document.getElementById('theme-preset');

    const sunPath = "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z";
    const moonPath = "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z";

    if (!btnThemeToggle || !themeIconPath) return;

    // 恢复上次保存的主题
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
    if (themePreset) themePreset.value = savedTheme;

    // 循环按钮：点击顺序 dark → light → green → amber → dark
    btnThemeToggle.addEventListener('click', (event) => {
        const current = document.body.getAttribute('data-theme') || 'dark';
        const idx = THEMES.indexOf(current);
        const nextTheme = THEMES[(idx + 1) % THEMES.length];
        applyTheme(nextTheme);
        if (themePreset) themePreset.value = nextTheme;
        if (document.startViewTransition) {
            const x = event.clientX, y = event.clientY;
            const endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
            document.startViewTransition(() => {}).ready.then(() => {
                document.documentElement.animate(
                    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
                    { duration: THEME.TRANSITION_DURATION, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' }
                );
            });
        }
    });

    // 下拉菜单选择
    if (themePreset) {
        themePreset.addEventListener('change', (e) => {
            applyTheme(e.target.value);
        });
    }

    function applyTheme(theme) {
        if (!theme || theme === 'dark') {
            document.body.removeAttribute('data-theme');
            themeIconPath.setAttribute('d', sunPath);
        } else {
            document.body.setAttribute('data-theme', theme);
            themeIconPath.setAttribute('d', moonPath);
        }
        localStorage.setItem('theme', theme);
    }
}
