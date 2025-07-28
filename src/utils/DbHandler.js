import { DbEmu } from '../emulator/kv.js';

let kvInstance = null;

export class DbHandler {
    constructor(namespace) {
        if (!kvInstance) {
            // Check if running in a Node.js environment (like Express) or Cloudflare Workers
            if (typeof process !== 'undefined' && process.release.name === 'node') {
                console.debug("Running in Node.js environment, using JSON");
                this.kv = new DbEmu('LYRICSPLUS');
            } else {
                console.debug("Running in Cloudflare Workers environment. using KV");
                this.kv = namespace;
            }
            kvInstance = this;
        }
        return kvInstance;
    }

    static init(namespace) {
        // If an instance already exists, return it. Otherwise, create a new one.
        if (kvInstance) {
            return kvInstance;
        }
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
            // The emulator and the real KV might return strings or objects.
            // The original code expects JSON.parse, so we ensure the value is a string before parsing.
            if (typeof value === 'string') {
                 return value ? JSON.parse(value) : null;
            }
            return value; // Already an object from the emulator
        } catch (error) {
            console.error(`Error getting key ${key}:`, error);
            return null;
        }
    }

    async set(key, value, expirationTtl = null) {
        try {
            const options = expirationTtl ? { expirationTtl } : {};
            // The emulator expects an object, the real KV expects a string.
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