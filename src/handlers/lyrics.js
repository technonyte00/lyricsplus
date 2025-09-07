
// src/handlers/lyrics.js
import { handleSongLyrics, safeFetchSongs } from "../controllers/lyricsHandler.js";
import { createJsonResponse } from "../utils/responseHelper.js";
import { convertJsonToTTML, v2Tov1 } from "../utils/mapHandler.js";
import GoogleDrive from "../utils/googleDrive.js";

const gd = new GoogleDrive();

export async function handleLyricsGet(request, env, ctx) {
    const startTime = Date.now();
    const { query } = request;
    const songTitle = query.title;
    const songArtist = query.artist;
    if (!songTitle || !songArtist) {
        return createJsonResponse(
            { error: "Missing required parameters: title and artist" },
            400
        );
    }
    const songAlbum = query.album || "";
    const songDuration = query.duration;
    const source = query.source;
    const forceReload = query.forceReload === "true";

    const songs = await safeFetchSongs();

    const result = await handleSongLyrics(
        songTitle,
        songArtist,
        songAlbum,
        songDuration,
        songs,
        gd,
        source ? source.split(",") : undefined,
        forceReload,
        env
    );
    const data = v2Tov1(result.data);
    data.processingTime = {
        timeElapsed: Date.now() - startTime,
        lastProcessed: Date.now(),
    };

    if (result.success) {
        return createJsonResponse(data, 200, {
            "Cache-Control": "public, max-age=3600, immutable",
        });
    } else {
        return createJsonResponse({ error: data }, result.status || 400, {
            "Cache-Control": "no-store",
        });
    }
}

export async function handleLyricsGetV2(request, env, ctx) {
    const startTime = Date.now();
    const { query } = request;
    const songTitle = query.title;
    const songArtist = query.artist;
    if (!songTitle || !songArtist) {
        return createJsonResponse(
            { error: "Missing required parameters: title and artist" },
            400
        );
    }
    const songDuration = query.duration;
    const songAlbum = query.album || "";
    const source = query.source;
    const forceReload = query.forceReload === "true";

    const songs = await safeFetchSongs();

    const result = await handleSongLyrics(
        songTitle,
        songArtist,
        songAlbum,
        songDuration,
        songs,
        gd,
        source ? source.split(",") : undefined,
        forceReload,
        env
    );
    let data;
    data = result.data;
    data.processingTime = {
        timeElapsed: Date.now() - startTime,
        lastProcessed: Date.now(),
    };

    if (result.success) {
        return createJsonResponse(data, 200, {
            "Cache-Control": "public, max-age=3600, immutable",
        });
    } else {
        return createJsonResponse({ error: data }, result.status || 400, {
            "Cache-Control": "no-store",
        });
    }
}

export async function handleTtmlGet(request, env, ctx) {
    const startTime = Date.now();
    const { query } = request;
    const songTitle = query.title;
    const songArtist = query.artist;
    if (!songTitle || !songArtist) {
        return createJsonResponse(
            { error: "Missing required parameters: title and artist" },
            400
        );
    }
    const songAlbum = query.album || "";
    const songDuration = query.duration;
    const source = query.source;
    const forceReload = query.forceReload === "true";

    const songs = await safeFetchSongs();

    const result = await handleSongLyrics(
        songTitle,
        songArtist,
        songAlbum,
        songDuration,
        songs,
        gd,
        source ? source.split(",") : undefined,
        forceReload,
        env
    );
    let data = {};
    let tempData;
    try {
        tempData = result.data;
        tempData = convertJsonToTTML(tempData);
        data.ttml = tempData
    } catch (e) {
        tempData = result.data;
    }
    data.processingTime = {
        timeElapsed: Date.now() - startTime,
        lastProcessed: Date.now(),
    };

    if (result.success) {
        return createJsonResponse(data, 200, {
            "Cache-Control": "public, max-age=3600, immutable",
        });
    } else {
        return createJsonResponse({ error: data }, result.status || 400, {
            "Cache-Control": "no-store",
        });
    }
}
