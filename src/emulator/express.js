
// src/emulator/express.js
import { DbEmu } from './kv.js';
import { corsHeaders } from '../middleware/corsMiddleware.js'; // Import corsHeaders
import { DbHandler } from '../utils/DbHandler.js';

// Function to convert a Cloudflare Request to an Express-like request object
function toExpressRequest(req) {
    return {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params,
    };
}

// Function to convert a custom Response to an Express response
async function toExpressResponse(response, res) {
    const { status, headers, body } = response;
    res.status(status);
    for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
    }
    if (typeof body === 'object') {
        res.json(body);
    } else {
        res.send(body);
    }
}

// This function will apply your custom routes to an Express app
export function applyRoutes(app, routes) {
    // Custom CORS middleware
    app.use((req, res, next) => {
        for (const header in corsHeaders) {
            res.setHeader(header, corsHeaders[header]);
        }
        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
            return res.status(204).send();
        }
        next();
    });

    // Rate limiting middleware for Express
    app.use(async (req, res, next) => {
        const db = DbHandler.getInstance(new DbEmu('LYRICSPLUS')); // Use DbEmu for Express environment
        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const key = `rate_limit:${ip}`;
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 minute
        const maxRequests = 100;

        let requests = await db.get(key) || [];

        // Filter out requests older than the window
        requests = requests.filter(timestamp => now - timestamp < windowMs);

        if (requests.length >= maxRequests) {
            return res.status(429).json({
                status: 429,
                message: 'Too Many Requests',
                path: req.originalUrl,
            });
        }

        requests.push(now);
        await db.set(key, requests, windowMs / 1000); // Store for the duration of the window

        next();
    });

    routes.forEach(route => {
        const path = route.path.replace(/\/:(.+?)(?:\/|$)/g, ':$1'); // Convert /:id/ to :id
        app[route.method.toLowerCase()](path, async (req, res) => {
            try {
                const request = toExpressRequest(req);
                const env = {
                    LYRICSPLUS: new DbEmu('LYRICSPLUS'),
                };
                const ctx = {}; // Add any context you need for Express

                const response = await route.handler(request, env, ctx);
                await toExpressResponse(response, res);
            } catch (error) {
                console.error(`Error handling route ${route.method} ${route.path}:`, error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });
    });

    // Handle 404 - Not Found
    app.use((req, res, next) => {
        res.status(404).json({
            status: 404,
            message: 'Path not found',
            path: req.originalUrl,
        });
    });
}
