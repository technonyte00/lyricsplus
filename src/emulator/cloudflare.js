
// src/emulator/cloudflare.js
import { corsHeaders, handleOptions } from '../middleware/corsMiddleware.js'; // Import corsHeaders and handleOptions

// This function takes your custom routes and creates a Cloudflare Worker fetch handler
export function createCfHandler(routes) {
    return async (request, env, ctx) => {
        const url = new URL(request.url);
        const { pathname } = url;

        // Apply rate limiting for Cloudflare Workers
        const { success } = await env.MY_RATE_LIMITER.limit({ key: pathname });
        if (!success) {
            return new Response(`429 Failure – rate limit exceeded for ${pathname}`, { status: 429 });
        }

        // Handle OPTIONS requests for CORS preflight
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }

        for (const route of routes) {
            const match = matchRoute(route.path, pathname);
            if (match && request.method.toLowerCase() === route.method.toLowerCase()) {
                const cfRequest = {
                    ...request,
                    params: match.params,
                    query: Object.fromEntries(url.searchParams),
                };
                const handlerResponse = await route.handler(cfRequest, env, ctx);
                if (handlerResponse instanceof Response) {
                    // Apply CORS headers to existing Response objects
                    const responseWithCors = new Response(handlerResponse.body, handlerResponse);
                    for (const header in corsHeaders) {
                        responseWithCors.headers.set(header, corsHeaders[header]);
                    }
                    return responseWithCors;
                }

                const { body, status, headers } = handlerResponse;

                //toCfResponse - Apply CORS headers here
                const response = new Response(JSON.stringify(body), { status, headers });
                for (const header in corsHeaders) {
                    response.headers.set(header, corsHeaders[header]);
                }
                return response;
            }
        }

        // Handle 404 - Not Found in JSON format
        return new Response(JSON.stringify({
            status: 404,
            message: 'Path not found',
            path: pathname,
        }), {
            status: 404,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders // Apply CORS headers to 404 response
            }
        });
    };
}

// Helper function to match a route path with a pathname, including params
function matchRoute(routePath, pathname) {
    const routeParts = routePath.split('/').filter(p => p);
    const pathParts = pathname.split('/').filter(p => p);

    if (routeParts.length !== pathParts.length) {
        return null;
    }

    const params = {};
    for (let i = 0; i < routeParts.length; i++) {
        const routePart = routeParts[i];
        const pathPart = pathParts[i];

        if (routePart.startsWith(':')) {
            params[routePart.substring(1)] = pathPart;
        } else if (routePart !== pathPart) {
            return null;
        }
    }

    return { params };
}
