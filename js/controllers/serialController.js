/**
 * ==========================================
 * Serial Controller - 串口控制器
 * ==========================================
 * 负责处理串口通信、协议解析
 */

import { STATE, DOM, showSysModal } from '../core.js';
import { SerialEngine } from '../serial.js';
import { initAudio, AudioState } from '../audio.js';

export function initSerialController() {
    if (DOM.btnSerialOpen) {
        DOM.btnSerialOpen.addEventListener('click', () => SerialEngine.connect());
    }

    if (DOM.btnSerialClose) {
        DOM.btnSerialClose.addEventListener('click', () => SerialEngine.disconnect());
    }

    if (DOM.serialProtocol) {
        DOM.serialProtocol.addEventListener('change', () => {
            SerialEngine.textBuffer = '';
            SerialEngine.linearBuffer = new Uint8Array(0);
            SerialEngine.textDecoder = new TextDecoder();
        });
    }

    if (DOM.serialBaud) {
        DOM.serialBaud.addEventListener('change', () => {
            const baud = parseInt(DOM.serialBaud.value);
            // 波特率已选择: ${baud} bps
            // 只记录日志，不改变任何状态
            // 真正的模式切换在点击连接按钮时进血
        });
    }
    
    // 串口连接状态变化控制波特率选择器启用禁用
    const updateBaudUI = (connected) => {
        if (DOM.serialBaud) {
            DOM.serialBaud.disabled = connected;
            DOM.serialBaud.style.opacity = connected ? '0.5' : '1';
        }
    };
    
    // 注册事件驱动回调，替代轮诀
    SerialEngine.setStateChangeCallbacks(
        () => updateBaudUI(true),
        () => updateBaudUI(false)
    );

    if ('serial' in navigator) {
        navigator.serial.addEventListener('disconnect', (event) => {
            if (SerialEngine.port && event.target === SerialEngine.port) {
                SerialEngine.finalizeDisconnect();
            }
        });
    }
    STATE.serial.speaker = false;
    const btnSerialSpk = document.getElementById('btn-serial-spk');
    if (btnSerialSpk) {
        btnSerialSpk.addEventListener('click', () => {
            initAudio(); 
            if (AudioState.audioCtx && AudioState.audioCtx.state === 'suspended') {
                AudioState.audioCtx.resume();
            }
            
            STATE.serial.speaker = !STATE.serial.speaker;
            SerialEngine.toggleSpeaker(STATE.serial.speaker);

            if (STATE.serial.speaker) {
                btnSerialSpk.innerText = '♪ 监听: 开';
                btnSerialSpk.classList.add('active');
            } else {
                btnSerialSpk.innerText = '♪ 监听';
                btnSerialSpk.classList.remove('active');
            }
        });
    }

    if (DOM.serialOutLeft) {
        DOM.serialOutLeft.addEventListener('change', (e) => {
            STATE.serialOutL = parseInt(e.target.value);
            initAudio();
        });
    }
    if (DOM.serialOutRight) {
        DOM.serialOutRight.addEventListener('change', (e) => {
            STATE.serialOutR = parseInt(e.target.value);
            initAudio();
        });
    }
}
