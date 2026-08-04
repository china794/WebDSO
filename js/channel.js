/**
 * ==========================================
 * Channel Management Module
 * ==========================================
 * Provides Channel and ChannelManager classes for channel state management
 */

import {
    SYSTEM, BUFFER, GRID, TRIGGER, MEASUREMENT, TIMEBASE,
    GENERATOR, CURSOR, AUDIO, SERIAL, RENDER, COLOR, MATH,
    FREQ_UNITS, VOLT_UNITS, TIME_UNITS, TIMING, WEBGL, SHADER, UI,
    THEME
} from './constants.js';

export class Channel {
    #state;

    constructor(id, initialState = {}) {
        this.id = id;
        this.#state = {
            on: initialState.on ?? (id <= SYSTEM.DEFAULT_ACTIVE_CHANNELS),
            pos: initialState.pos ?? 0.0,
            scale: initialState.scale ?? 4.0,
            cpl: initialState.cpl ?? 'DC',
            genType: initialState.genType ?? 'sine',
            genFreq: initialState.genFreq ?? GENERATOR.DEFAULT_FREQ,
            genAmp: initialState.genAmp ?? GENERATOR.DEFAULT_AMP
        };
        this.rawData = null;
        this.processedData = null;
    }

    bindBuffers(buffers) {
        this.rawData = buffers[`data${this.id}`];
        this.processedData = buffers[`pData${this.id}`];
    }

    get on() { return this.#state.on; }
    set on(value) { this.#state.on = value; }

    get pos() { return this.#state.pos; }
    set pos(value) { this.#state.pos = value; }

    get scale() { return this.#state.scale; }
    set scale(value) { this.#state.scale = value; }

    get cpl() { return this.#state.cpl; }
    set cpl(value) { this.#state.cpl = value; }

    get genType() { return this.#state.genType; }
    set genType(value) { this.#state.genType = value; }

    get genFreq() { return this.#state.genFreq; }
    set genFreq(value) { this.#state.genFreq = value; }

    get genAmp() { return this.#state.genAmp; }
    set genAmp(value) { this.#state.genAmp = value; }

    getState() {
        return { ...this.#state };
    }

    setState(newState) {
        Object.assign(this.#state, newState);
    }

    toggle() {
        this.#state.on = !this.#state.on;
        return this.#state.on;
    }

    getVPerDiv() {
        return (1 / this.#state.scale).toFixed(2);
    }

    getColor(isLight = false) {
        return null;
    }

    reset() {
        this.#state = {
            on: this.id <= SYSTEM.DEFAULT_ACTIVE_CHANNELS,
            pos: 0.0,
            scale: 4.0,
            cpl: 'DC',
            genType: 'sine',
            genFreq: GENERATOR.DEFAULT_FREQ,
            genAmp: GENERATOR.DEFAULT_AMP
        };
    }

    exportConfig() {
        return { ...this.#state };
    }

    importConfig(config) {
        this.#state = {
            on: config.on ?? this.#state.on,
            pos: config.pos ?? this.#state.pos,
            scale: config.scale ?? this.#state.scale,
            cpl: config.cpl ?? this.#state.cpl,
            genType: config.genType ?? this.#state.genType,
            genFreq: config.genFreq ?? this.#state.genFreq,
            genAmp: config.genAmp ?? this.#state.genAmp
        };
    }
}

export class ChannelManager {
    constructor(count = SYSTEM.CHANNEL_COUNT) {
        this.count = count;
        this.channels = new Map();
        for (let i = 1; i <= count; i++) {
            this.channels.set(i, new Channel(i, { on: i <= SYSTEM.DEFAULT_ACTIVE_CHANNELS }));
        }
    }

    get(id) {
        return this.channels.get(id) || null;
    }

    forEach(callback) {
        this.channels.forEach((channel, id) => callback(channel, id));
    }

    forEachActive(callback) {
        this.channels.forEach((channel, id) => {
            if (channel.on) callback(channel, id);
        });
    }

    getActiveChannels() {
        const result = [];
        this.channels.forEach((channel, id) => {
            if (channel.on) result.push({ id, channel });
        });
        return result;
    }

    getActiveCount() {
        let count = 0;
        this.channels.forEach(channel => {
            if (channel.on) count++;
        });
        return count;
    }

    updateAll(updater) {
        this.channels.forEach((channel, id) => updater(channel, id));
    }

    resetAll() {
        this.channels.forEach(channel => channel.reset());
    }

    exportAllConfigs() {
        const configs = {};
        this.channels.forEach((channel, id) => {
            configs[`ch${id}`] = channel.exportConfig();
        });
        return configs;
    }

    importAllConfigs(configs) {
        this.channels.forEach((channel, id) => {
            const key = `ch${id}`;
            if (configs[key]) {
                channel.importConfig(configs[key]);
            }
        });
    }

    getIds() {
        return Array.from(this.channels.keys());
    }

    *[Symbol.iterator]() {
        for (const [id, channel] of this.channels) {
            yield { id, channel };
        }
    }
}

export const channelManager = new ChannelManager(SYSTEM.CHANNEL_COUNT);

export const Channels = {
    get: (id) => channelManager.get(id),
    forEach: (callback) => channelManager.forEach(callback),
    forEachActive: (callback) => channelManager.forEachActive(callback),
    getActiveChannels: () => channelManager.getActiveChannels(),
    manager: channelManager
};
