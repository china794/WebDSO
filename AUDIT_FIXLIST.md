# WebDSO Source Audit Fixlist

Saved: 2026-07-12
Scope: static source audit follow-up. Hardware timing, browser behavior, and sustained serial throughput still need device testing.

## Current Focus

1. Keep exactly one render loop alive.
2. Make imported waveform data visible while stopped.
3. Fix serial parser channel alignment and JustFloat cross-chunk sync tails.
4. Move math channel calculations out of screen-coordinate space.
5. Continue sampling-rate, trigger, FFT, buffer, and lifecycle repairs in small verifiable steps.

## P0

- [x] Multiple permanent RAF loops can be created by startup, resize while stopped, and config import.
- [x] Imported waveform may not display because raw `dataN` is loaded while processed `pDataN` remains empty and `run=false` skips processing.
- [x] JSON Lines missing channels can shift values into the wrong channel.
- [x] CSV empty fields can shift later channels left.
- [x] JustFloat can drop a sync marker split across serial read chunks.
- [ ] STATE / Store / ChannelManager are three state sources and need deletion or a single ownership model.
- [ ] Serial sample-rate model still uses baud-rate estimates for timebase, FFT, filters, and measurements.
- [ ] High-speed baud mode assumes a different frame size than the actual parser implements.
- [ ] Measured real serial sample rate is shown in OSD but not fed back into processing.
- [x] Math channel uses raw physical-domain calculations and correct dt for derivative/integral; display scaling is separate.
- [ ] JustFloat still has no frame length, CRC, sequence number, or timestamp; NaN sync can collide with payload.
- [ ] WebGL context restore needs to rebuild cached attribute locations and VBO state.

## P1

- [ ] Separate acquisition buffers, display buffers, FFT buffers, and long-term storage assumptions.
- [ ] Add effective sample count so startup zero-fill does not enter trigger, measurement, and FFT as real data.
- [ ] Add sample timestamps, packet sequence, and drop counters for serial input.
- [ ] Move protocol parsing, FFT, and heavy signal processing to Worker.
- [ ] Skip processing for disabled channels.
- [ ] Avoid full 8-channel ring-buffer linearization on every serial update.
- [ ] Reuse audio-mode temporary arrays to reduce GC.
- [ ] Throttle or request-drive FFT instead of per-frame per-channel transforms.
- [ ] Remove unused serial downsample cache or wire it into rendering with correct ring order and min/max.
- [ ] Revisit WebGL dynamic vertex expansion and buffer uploads.
- [ ] Remove unused Bloom/FBO allocations unless the effect is actually rendered.
- [ ] Use dirty rendering paths while stopped.
- [ ] Reduce binary serial parser copying/allocation.
- [ ] Clean up serial audio monitor allocation pattern.

## P2

- [x] Trigger search now runs after current-frame display processing, so it no longer uses stale `pData` in the main render path.
- [ ] Trigger holdoff semantics need review.
- [ ] HF Reject and LF Reject should compose instead of one overwriting the other.
- [ ] Trigger filtering should avoid full-buffer allocation per search.
- [ ] Trigger search should honor viewport-related parameters.
- [ ] AC coupling display and measurement algorithms should match.
- [ ] Add input range, ADC reference, probe factor, zero offset, and gain calibration model.
- [ ] Improve frequency measurement interpolation and robustness.
- [ ] Add FFT windowing, DC removal, amplitude normalization, and correct Nyquist limit.
- [ ] Remove FFT multi-channel x-offset or make it explicit visual separation.
- [ ] Fix peak-hold rendering artifacts and line-width pixel stability.
- [ ] Reference waveform should store raw signal, not transformed screen coordinates.
- [ ] Clamp math waveform viewport start to avoid negative indexes.
- [ ] Math labels should reflect selected sources.
- [ ] Math/ref rendering need peak preservation for narrow pulses.
- [ ] Fix minimap zero handling, bucket bounds, DPR, and highlight clamping.
- [ ] Hover panel should count 0 V as present.
- [ ] Gesture timebase limits and UI slider sync need serial-mode awareness.

## P3

- [x] Serial disconnect now calls UI disconnect callbacks on normal disconnect, physical unplug, read-loop end, and read-loop errors.
- [x] Protocol switching resets TextDecoder stream state as well as text/binary buffers.
- [x] Text protocols cap textBuffer length and keep only the latest unclosed tail.
- [ ] Custom/HEX protocol option should either work or be removed.
- [ ] Config import needs schema/type/range/array-length validation.
- [ ] Config import should await async serial disconnect.
- [ ] Importing `power=false` needs a clear recovery path.
- [ ] Large waveform export should avoid pretty JSON memory spikes.
- [ ] Screenshot path should avoid blocking work where possible and reuse shared WebGL context.
- [ ] Audio download and node lifecycle cleanup need consolidation.

## P4

- [ ] Remove or truly integrate unused Store/proxy/ChannelManager pieces.
- [ ] Align Channel and STATE defaults.
- [ ] Finish or remove incomplete Channel.getColor().
- [ ] Wire i18n or remove unused file.
- [ ] Decide PWA/service-worker strategy; currently registration/cache logic conflicts.
- [ ] Update README claims to match runtime behavior.
- [ ] Remove misleading TODO headers and unused imports/constants.
- [ ] Consolidate FPS/perf monitors and stage timings.
- [ ] Add LICENSE.
- [ ] Move large audio/background assets out of ordinary Git history if this becomes a repo.
- [ ] Add unit/protocol/render/perf/browser regression tests and CI.

## Verification Log

- 2026-07-12: `node --check` passed for `js/render/index.js`, `js/main.js`, `js/controllers/configController.js`, `js/serial/protocols.js`.
- 2026-07-12: Parser sample checks passed for CSV empty field alignment, JSON `ch2` alignment, and JustFloat split sync-tail retention.
- 2026-07-12: Math channel moved from processed screen-coordinate pData to raw data buffers; derivative/integral now use sample-rate-derived dt.
- 2026-07-12: Render pipeline split display processing from analysis; trigger calculation now sees current-frame processed data before measurements/Math run.
- 2026-07-12: Serial disconnect finalization unified; read loop uses local reader locks; protocol changes reset TextDecoder.
- 2026-07-12: Text protocol parsers cap unclosed text buffers at 64 KiB.
- 2026-07-12: Restored full signal processing module after replacing Math implementation; checked exports for processData, findTriggerIndex, updateMeasurements, and updateMathData.
