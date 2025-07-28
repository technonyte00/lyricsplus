// src/handlers/songCatalog.js
import { SongCatalogService } from "../services/songCatalogService.js";
import { createJsonResponse } from "../utils/responseHelper.js";

export async function handleSonglistSearch(request, env, ctx) {
    const startTime = Date.now();
    const { query } = request;
    const q = query.q;

    if (!q) {
        return createJsonResponse({ error: "Missing required parameter: q (query)" }, 400);
    }

    try {
        const results = await SongCatalogService.search(q, env);
        return createJsonResponse({
            results,
            processingTime: {
                timeElapsed: Date.now() - startTime,
                lastProcessed: Date.now(),
            },
        }, 200);
    } catch (error) {
        console.error("Error handling song catalog search:", error);
        return createJsonResponse(
            { error: "Internal Server Error", details: error.message },
            500,
            { "Cache-Control": "no-store" }
        );
    }
}
