import { DbEmu } from '../emulator/kv.js';

let kvInstance = null;

export class DbHandler {
    constructor(namespace) {
        if (!kvInstance) {
            if (typeof globalThis?.WebSocketPair !== 'undefined') {
                console.debug("Running in Cloudflare Workers environment, using KV");
                this.kv = namespace;
            } else if (process?.env?.VERCEL === '1') {
                console.debug("Running in Vercel environment, using Vercel KV");
                try {
                    const { kv } = require('@vercel/kv');
                    this.kv = kv;
                } catch (err) { }
            } else if (typeof process !== 'undefined' && process.release?.name === 'node') {
                console.debug("Running in Node.js environment, using JSON emulator");
                this.kv = new DbEmu('LYRICSPLUS');
            } else {
                console.warn("Unknown environment, fallback to DbEmu");
                this.kv = new DbEmu('LYRICSPLUS');
            }

            kvInstance = this;
        }
        return kvInstance;
    }

    static init(namespace) {
        if (kvInstance) return kvInstance;
        return new DbHandler(namespace);
    }

    static getInstance(namespace) {
        if (!kvInstance) {
            return new DbHandler(namespace);
        }
        return kvInstance;
    }

    async get(key) {
        try {
            const value = await this.kv.get(key);
            if (typeof value === 'string') {
                return value ? JSON.parse(value) : null;
            }
            return value;
        } catch (error) {
            console.error(`Error getting key ${key}:`, error);
            return null;
        }
    }

    async set(key, value, expirationTtl = null) {
        try {
            const options = expirationTtl ? { expirationTtl } : {};
            const valueToStore = typeof value === 'string' ? value : JSON.stringify(value);
            await this.kv.put(key, valueToStore, options);
            return true;
        } catch (error) {
            console.error(`Error setting key ${key}:`, error);
            return false;
        }
    }

    async delete(key) {
        try {
            await this.kv.delete(key);
            return true;
        } catch (error) {
            console.error(`Error deleting key ${key}:`, error);
            return false;
        }
    }

    async list(prefix = null) {
        try {
            const options = prefix ? { prefix } : {};
            const list = await this.kv.list(options);
            return list.keys;
        } catch (error) {
            console.error('Error listing keys:', error);
            return [];
        }
    }
}
