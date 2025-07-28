
// src/handlers/test.js
import { MusixmatchService } from "../services/musixmatchService.js";
import { createJsonResponse } from "../utils/responseHelper.js";

export async function handleMusixmatchTest(request, env, ctx) {
    const { query } = request;
    const artist = query.artist;
    const track = query.track;

    if (!artist || !track) {
        return createJsonResponse(
            { error: 'Please provide both artist and track name' },
            400
        );
    }

    try {
        const userToken = await MusixmatchService.getUserToken(env);
        const searchResults = await MusixmatchService.searchTrack(`${track} ${artist}`, userToken);
        const trackResults = searchResults.message.body.macro_result_list.track_list;

        if (trackResults.length === 0) {
            return createJsonResponse({ error: 'No tracks found' }, 404);
        }

        const trackId = trackResults[0].track.track_id;
        const lyricsResult = await MusixmatchService.getRichLyrics(trackId, userToken);

        return createJsonResponse({
            track: trackResults[0].track,
            lyrics: lyricsResult
        });

    } catch (error) {
        return createJsonResponse(
            {
                error: 'Failed to fetch track information',
                details: error.message
            },
            500
        );
    }
}
