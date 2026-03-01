/**
 * ==========================================
 * Theme Controller - 主题切换控制器
 * ==========================================
 * 负责处理主题切换、动画效果
 */

// TODO: 实现主题切换逻辑
import { THEME } from '../constants.js';

export function initThemeController() {
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const themeIconPath = document.getElementById('theme-icon-path');

    const sunPath = "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z";
    const moonPath = "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z";

    if (!btnThemeToggle || !themeIconPath) return;

    const currentTheme = localStorage.getItem('theme') || 'dark';
    if (currentTheme === 'light') {
        document.body.setAttribute('data-theme', 'light');
        themeIconPath.setAttribute('d', moonPath);
    }

    btnThemeToggle.addEventListener('click', (event) => {
        if (!document.startViewTransition) {
            toggleTheme();
            return;
        }

        const x = event.clientX;
        const y = event.clientY;
        const endRadius = Math.hypot(
            Math.max(x, innerWidth - x),
            Math.max(y, innerHeight - y)
        );

        const transition = document.startViewTransition(() => {
            toggleTheme();
        });

        transition.ready.then(() => {
            const clipPath = [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`
            ];

            document.documentElement.animate(
                { clipPath: clipPath },
                {
                    duration: THEME.TRANSITION_DURATION,
                    easing: 'ease-out',
                    pseudoElement: '::view-transition-new(root)'
                }
            );
        });
    });

    function toggleTheme() {
        const isLight = document.body.getAttribute('data-theme') === 'light';
        if (isLight) {
            document.body.removeAttribute('data-theme');
            localStorage.setItem('theme', 'dark');
            themeIconPath.setAttribute('d', sunPath);
        } else {
            document.body.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
            themeIconPath.setAttribute('d', moonPath);
        }
    }
}