
// src/index-wrangler.js
import { createCfHandler } from './emulator/cloudflare.js';
import routes from './routes/index.js';

export default {
    fetch: createCfHandler(routes)
};
