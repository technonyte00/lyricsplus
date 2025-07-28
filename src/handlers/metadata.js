
// src/handlers/metadata.js
import { AppleMusicService } from "../services/appleMusicService.js";
import { SimilarityUtils } from "../utils/similarityUtils.js";
import { createJsonResponse } from "../utils/responseHelper.js";

export async function handleMetadataGet(request, env, ctx) {
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

    try {
        const dev_token = await AppleMusicService.getAppleMusicAuth();
        const storefront = await AppleMusicService.getStorefront();

        const searchQueries = [
            [songTitle, songArtist, songAlbum].filter(Boolean).join(" "),
            [songTitle, songArtist].filter(Boolean).join(" "),
            `${songArtist} ${songTitle}`,
            songTitle,
        ];

        let candidates = [];
        let bestMatch = null;

        for (const query of searchQueries) {
            try {
                const searchData = await AppleMusicService.searchSong(query, dev_token, storefront);
                const newCandidates = searchData.results?.songs?.data || [];
                candidates = candidates.concat(newCandidates);

                bestMatch = SimilarityUtils.findBestSongMatch(candidates, songTitle, songArtist, songAlbum, songDuration);
                if (bestMatch) break;
            } catch (error) {
                console.error(`Error during search with query "${query}":`, error);
            }
        }

        if (bestMatch) {
            const metadata = {
                ...bestMatch.candidate.attributes,
                isVocalAttenuationAllowed: undefined,
                isMasteredForItunes: undefined,
                url: undefined,
                playParams: undefined,
                discNumber: undefined,
                isAppleDigitalMaster: undefined,
                hasLyrics: undefined,
                audioTraits: undefined,
                hasTimeSyncedLyrics: undefined
            };
            return createJsonResponse({ metadata }, 200);
        } else {
            return createJsonResponse({ error: "Could not find metadata" }, 404);
        }
    } catch (error) {
        console.error("Error in to get metadata:", error);
        return createJsonResponse({ error: error.message }, 500);
    }
}
