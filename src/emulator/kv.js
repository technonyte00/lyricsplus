
// src/emulator/kv.js
// A simple in-memory DB store emulator for Express, with disk persistence

import fs from 'fs/promises';
import path from 'path';

const DB_DIR = path.join(process.cwd(), 'database');
const DB_FILE_PATH = path.join(DB_DIR, 'code_data.json');

let store = new Map();

async function loadStore() {
    try {
        await fs.mkdir(DB_DIR, { recursive: true });
        const data = await fs.readFile(DB_FILE_PATH, 'utf8');
        store = new Map(JSON.parse(data));
        console.debug('Database store loaded from disk.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.debug('Database store file not found, initializing empty store.');
            store = new Map();
        } else if (error.message.includes('fs.mkdir is not implemented yet!')) {
            // Suppress the error for environments where fs is not available
            store = new Map(); // Ensure store is initialized even if fs is not available
        } else {
            console.error('Error loading Database store from disk:', error);
            // Fallback to empty store if loading fails
            store = new Map();
        }
    }
}

async function saveStore() {
    try {
        await fs.mkdir(DB_DIR, { recursive: true });
        await fs.writeFile(DB_FILE_PATH, JSON.stringify(Array.from(store.entries())), 'utf8');
        console.debug('Database store saved to disk.');
    } catch (error) {
        if (error.message.includes('fs.mkdir is not implemented yet!')) {
            // Suppress the error for environments where fs is not available
        } else {
            console.error('Error saving Database store to disk:', error);
        }
    }
}

// Load the store when the module is initialized
loadStore();

export class DbEmu {
    constructor(namespace) {
        this.namespace = namespace;
    }

    async get(key) {
        return store.get(`${this.namespace}:${key}`);
    }

    async put(key, value, options) {
        store.set(`${this.namespace}:${key}`, value);
        await saveStore();
    }

    async delete(key) {
        store.delete(`${this.namespace}:${key}`);
        await saveStore();
    }

    async list(options) {
        const keys = [];
        for (const key of store.keys()) {
            if (key.startsWith(`${this.namespace}:`)) {
                keys.push({ name: key.split(':')[1] });
            }
        }
        return { keys };
    }
}

export default new DbEmu('LYRICSPLUS');
