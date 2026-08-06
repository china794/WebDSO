/**
 * ==========================================
 * Config Controller - 配置管理控制器
 * ==========================================
 * 负责处理配置导入导出、状态保存
 */

import { STATE, DOM, Buffers, CHANNEL_COUNT, showSysModal } from '../core.js';
import { AudioState } from '../audio.js';
import { SerialEngine } from '../serial.js';
import { renderSingleFrame, startRenderLoop, stopRenderLoop } from '../render/index.js';
import { refreshVerticalCard, refreshInputCard, currentSelectedCh, getInputCh } from './inputController.js';
import { syncFftUI } from './fftController.js';

export function initConfigController() {
    const btnExportConfig = document.getElementById('btn-export-config');
    const btnImportConfig = document.getElementById('btn-import-config');
    const fileImportConfig = document.getElementById('file-import-config');

    if (btnExportConfig) {
        btnExportConfig.addEventListener('click', () => {
            const exportData = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                config: {
                    power: STATE.power, run: STATE.run, mode: STATE.mode, hpos: STATE.hpos,
                    secPerDiv: STATE.secPerDiv, trigger: { ...STATE.trigger }, measure: STATE.measure, cursor: { ...STATE.cursor },
                    fft: { on: STATE.fft.on, maxFreq: STATE.fft.maxFreq, gain: STATE.fft.gain, logScale: STATE.fft.logScale, showPeaks: STATE.fft.showPeaks, smoothing: STATE.fft.smoothing },
                    awgOutL: STATE.awgOutL, awgOutR: STATE.awgOutR, serialOutL: STATE.serialOutL, serialOutR: STATE.serialOutR
                },
                channels: {}, waveformData: {}
            };

            for (let i = 1; i <= CHANNEL_COUNT; i++) {
                const ch = STATE['ch' + i];
                exportData.channels['ch' + i] = { on: ch.on, pos: ch.pos, scale: ch.scale, cpl: ch.cpl, genType: ch.genType, genFreq: ch.genFreq, genAmp: ch.genAmp };
                exportData.waveformData['ch' + i] = Array.from(Buffers['data' + i]);
            }

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `WebDSO_Config_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            showSysModal('Export complete', 'Configuration and waveform data exported as JSON.');
        });
    }

    if (btnImportConfig && fileImportConfig) {
        btnImportConfig.addEventListener('click', () => fileImportConfig.click());

        fileImportConfig.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importData = JSON.parse(event.target.result);
                    if (!importData.config || !importData.channels) throw new Error('Invalid configuration file format');

                    // 清除原有状态
                    if (AudioState.isMusicPlaying) {
                        if (AudioState.bufferSource) { try { AudioState.bufferSource.stop(); } catch (e) { } AudioState.bufferSource.disconnect(); AudioState.bufferSource = null; }
                        AudioState.isMusicPlaying = false; if (DOM.btnAudioToggle) DOM.btnAudioToggle.innerText = 'Play';
                    }
                    AudioState.audioBuffer = null; AudioState.startOffset = 0;
                    if (DOM.audioSeekBar) DOM.audioSeekBar.value = 0;
                    if (DOM.lblAudioTime) DOM.lblAudioTime.innerText = '--:-- / --:--';
                    if (STATE.serial.connected) SerialEngine.disconnect();

                    for (let i = 1; i <= CHANNEL_COUNT; i++) { Buffers['data' + i].fill(0); Buffers['pData' + i].fill(0); }

                    // 应用新配置
                    const cfg = importData.config;
                    STATE.power = cfg.power ?? STATE.power; STATE.run = false; STATE.mode = cfg.mode ?? STATE.mode;
                    STATE.hpos = cfg.hpos ?? STATE.hpos; STATE.secPerDiv = cfg.secPerDiv ?? STATE.secPerDiv;
                    STATE.trigger = { ...STATE.trigger, ...cfg.trigger }; STATE.measure = cfg.measure ?? STATE.measure;
                    STATE.cursor = { ...STATE.cursor, ...cfg.cursor };
                    if (cfg.fft) { STATE.fft.on = cfg.fft.on ?? STATE.fft.on; STATE.fft.maxFreq = cfg.fft.maxFreq ?? STATE.fft.maxFreq; STATE.fft.gain = cfg.fft.gain ?? STATE.fft.gain; STATE.fft.logScale = cfg.fft.logScale ?? STATE.fft.logScale; STATE.fft.showPeaks = cfg.fft.showPeaks ?? STATE.fft.showPeaks; STATE.fft.smoothing = cfg.fft.smoothing ?? STATE.fft.smoothing; }
                    STATE.awgOutL = cfg.awgOutL ?? STATE.awgOutL; STATE.awgOutR = cfg.awgOutR ?? STATE.awgOutR;
                    STATE.serialOutL = cfg.serialOutL ?? STATE.serialOutL; STATE.serialOutR = cfg.serialOutR ?? STATE.serialOutR;

                    for (let i = 1; i <= CHANNEL_COUNT; i++) {
                        const chKey = 'ch' + i;
                        if (importData.channels[chKey]) {
                            const chCfg = importData.channels[chKey], ch = STATE[chKey];
                            ch.on = chCfg.on ?? ch.on; ch.pos = chCfg.pos ?? ch.pos; ch.scale = chCfg.scale ?? ch.scale; ch.cpl = chCfg.cpl ?? ch.cpl;
                            ch.genType = chCfg.genType ?? ch.genType; ch.genFreq = chCfg.genFreq ?? ch.genFreq; ch.genAmp = chCfg.genAmp ?? ch.genAmp;
                        }
                    }

                    if (importData.waveformData) {
                        for (let i = 1; i <= CHANNEL_COUNT; i++) {
                            const chKey = 'ch' + i;
                            if (importData.waveformData[chKey]) {
                                const data = new Float32Array(importData.waveformData[chKey]);
                                Buffers['data' + i].set(data.subarray(0, Buffers['data' + i].length));
                            }
                        }
                    }

                    // 刷新UI绑定
                    refreshVerticalCard(currentSelectedCh); refreshInputCard(getInputCh());
                    
                    if (DOM.osdRunState) { DOM.osdRunState.innerText = 'stop'; DOM.osdRunState.style.background = 'var(--color-stop)'; }
                    if (DOM.btnRunstop) { DOM.btnRunstop.innerText = 'Run'; DOM.btnRunstop.classList.remove('active'); DOM.btnRunstop.classList.add('stopped'); }
                    if (DOM.knobTimebase) DOM.knobTimebase.value = STATE.secPerDiv;
                    if (DOM.lblTimebase) DOM.lblTimebase.innerText = STATE.secPerDiv.toFixed(2) + 'ms';
                    // osdTimebase 由渲染循环更斀

                    if (DOM.btnTrigEn) { DOM.btnTrigEn.innerText = STATE.trigger.enabled ? 'Trigger: On' : 'Trigger: Off'; DOM.btnTrigEn.classList.toggle('active', STATE.trigger.enabled); }
                    if (DOM.trigSrc) DOM.trigSrc.value = STATE.trigger.src;
                    if (DOM.osdTriggerSrc) DOM.osdTriggerSrc.innerText = STATE.trigger.src;

                    if (DOM.btnCursors) { const cursorModes = ['Off', 'Voltage', 'Time']; DOM.btnCursors.innerText = 'Cursor: ' + cursorModes[STATE.cursor.mode]; DOM.btnCursors.classList.toggle('active', STATE.cursor.mode > 0); }
                    if (DOM.btnMeasure) { DOM.btnMeasure.classList.toggle('active', STATE.measure); document.getElementById('measure-panel').style.display = STATE.measure ? 'block' : 'none'; }
                    if (DOM.btnDisplay && DOM.btnXy) { if (STATE.mode === 'YT') { DOM.btnDisplay.classList.add('active'); DOM.btnXy.classList.remove('active'); } else { DOM.btnDisplay.classList.remove('active'); DOM.btnXy.classList.add('active'); } }
                    if (DOM.btnFftToggle) { syncFftUI(); }

                    if (DOM.awgOutLeft) DOM.awgOutLeft.value = STATE.awgOutL;
                    if (DOM.awgOutRight) DOM.awgOutRight.value = STATE.awgOutR;
                    if (DOM.serialOutLeft) DOM.serialOutLeft.value = STATE.serialOutL;
                    if (DOM.serialOutRight) DOM.serialOutRight.value = STATE.serialOutR;

                    for (let i = 1; i <= CHANNEL_COUNT; i++) {
                        const btn = document.getElementById('ch' + i + '-toggle');
                        if (btn) btn.classList.toggle('active', STATE['ch' + i].on);
                    }

                    showSysModal('Import complete', 'Configuration and waveform data imported. The oscilloscope is stopped.');
                    if (STATE.power) startRenderLoop(); else stopRenderLoop();
                    renderSingleFrame({ processPausedData: true });
                } catch (error) { console.error('Import error:', error); showSysModal('Import failed', 'Unable to parse configuration file: ' + error.message); }
                e.target.value = '';
            };
            reader.readAsText(file);
        });
    }

    // 导出截图 (PNG) - 使用 readPixels 从 GPU 读像素
    const btnExportPng = document.getElementById('btn-export-png');
    if (btnExportPng) {
        btnExportPng.addEventListener('click', () => {
            const glCanvas = DOM.glCanvas;
            const oscCanvas = DOM.oscilloscope;
            if (!glCanvas || !oscCanvas) return;
            try {
                const w = glCanvas.width;
                const h = glCanvas.height;
                const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
                if (!gl) { showSysModal('Export failed', 'WebGL is not available.'); return; }

                // 读取 WebGL canvas 像素数据
                const pixels = new Uint8Array(w * h * 4);
                gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                // WebGL Y 轴下向，需要翻轀
                const flipped = new Uint8Array(w * h * 4);
                for (let y = 0; y < h; y++) {
                    const srcRow = y * w * 4;
                    const dstRow = (h - 1 - y) * w * 4;
                    for (let x = 0; x < w * 4; x++) {
                        flipped[dstRow + x] = pixels[srcRow + x];
                    }
                }

                // 写入临时 canvas
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = w;
                tmpCanvas.height = h;
                const tmpCtx = tmpCanvas.getContext('2d');
                const imageData = tmpCtx.createImageData(w, h);
                imageData.data.set(flipped);
                tmpCtx.putImageData(imageData, 0, 0);

                // 叠加 Canvas2D 局
                tmpCtx.drawImage(oscCanvas, 0, 0);

                const link = document.createElement('a');
                link.download = 'WebDSO_Screenshot_' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
                link.href = tmpCanvas.toDataURL('image/png');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } catch (e) {
                showSysModal('Export failed', e.message);
            }
        });
    }
}
