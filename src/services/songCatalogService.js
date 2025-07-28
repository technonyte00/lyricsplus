import { SpotifyService } from "./spotifyService.js";
import { AppleMusicService } from "./appleMusicService.js";
import { MusixmatchService } from "./musixmatchService.js";
import { SimilarityUtils } from "../utils/similarityUtils.js";

export class SongCatalogService {
    /**
     * Searches for songs across multiple music services (Apple Music, Spotify, Musixmatch)
     * and normalizes the results to a custom format. Prioritizes Apple Music.
     * Compares songs by ISRC if names are different.
     *
     * @param {string} query - The search query (e.g., song title).
     * @param {object} env - Environment variables (for Musixmatch token).
     * @returns {Promise<Array<object>>} An array of normalized song metadata.
     */
    static async search(query, env) {
        const normalizedResults = [];

        const [appleMusicResult, spotifyResult, musixmatchResult] = await Promise.allSettled([
            (async () => {
                try {
                    const dev_token = await AppleMusicService.getAppleMusicAuth();
                    const storefront = await AppleMusicService.getStorefront();
                    const appleMusicSearchData = await AppleMusicService.searchSong(query, dev_token, storefront);
                    const appleMusicSongs = appleMusicSearchData.results?.songs?.data || [];
                    const songs = [];
                    for (const song of appleMusicSongs) {
                        const normalizedSong = await AppleMusicService.normalizeAppleMusicSong(song, dev_token, storefront);
                        songs.push(normalizedSong);
                    }
                    return songs;
                } catch (error) {
                    console.error("Error searching Apple Music:", error);
                    return [];
                }
            })(),
            (async () => {
                try {
                    // Spotify's search API requires both title and artist for effective search.
                    // Since the user wants only 'query', we'll pass the query as title and an empty string for artist.
                    // This might yield less precise results from Spotify but adheres to the "only uses query search" constraint.
                    const spotifyTracks = await SpotifyService.searchSpotifySong(query, "");
                    const tracks = [];
                    for (const track of spotifyTracks) {
                        const normalizedSong = await SpotifyService.normalizeSpotifySong(track);
                        tracks.push(normalizedSong);
                    }
                    return tracks;
                } catch (error) {
                    console.error("Error searching Spotify:", error);
                    return [];
                }
            })(),
            (async () => {
                try {
                    const userToken = await MusixmatchService.getUserToken(env);
                    const musixmatchSearchData = await MusixmatchService.searchTrack(query, userToken);
                    const musixmatchTracks = musixmatchSearchData.message?.body?.track_list || [];
                    const tracks = [];
                    for (const trackResult of musixmatchTracks) {
                        const track = trackResult.track;
                        const normalizedSong = await MusixmatchService.normalizeMusixmatchSong(track, userToken); // Pass userToken
                        tracks.push(normalizedSong);
                    }
                    return tracks;
                } catch (error) {
                    console.error("Error searching Musixmatch:", error);
                    return [];
                }
            })()
        ]);

        if (appleMusicResult.status === 'fulfilled') {
            normalizedResults.push(...appleMusicResult.value);
        }
        if (spotifyResult.status === 'fulfilled') {
            normalizedResults.push(...spotifyResult.value);
        }
        if (musixmatchResult.status === 'fulfilled') {
            normalizedResults.push(...musixmatchResult.value);
        }

        const finalResultsMap = new Map(); // Map to store songs, keyed by ISRC or a unique identifier for non-ISRC songs

        // Prioritize Apple Music, then Spotify, then Musixmatch for merging
        const sourceOrder = { 'Apple Music': 1, 'Spotify': 2, 'Musixmatch': 3 };
        const sortedResults = normalizedResults.sort((a, b) => {
            // Sort by source priority, then by title for consistent merging if ISRCs are missing
            const sourceComparison = sourceOrder[a.availability[0]] - sourceOrder[b.availability[0]];
            if (sourceComparison !== 0) return sourceComparison;
            return a.title.localeCompare(b.title);
        });

        for (const song of sortedResults) {
            const key = song.isrc || `${song.title}-${song.artist}-${song.album}`; // Use ISRC or a composite key

            if (finalResultsMap.has(key)) {
                const existingSong = finalResultsMap.get(key);

                // Merge IDs
                existingSong.id = { ...existingSong.id, ...song.id };

                // Merge songwriters, ensuring uniqueness
                existingSong.songwriters = [...new Set([...(existingSong.songwriters || []), ...(song.songwriters || [])])];

                // Merge external URLs
                existingSong.externalUrls = { ...existingSong.externalUrls, ...song.externalUrls };

                // Merge availability, ensuring uniqueness
                existingSong.availability = [...new Set([...(existingSong.availability || []), ...(song.availability || [])])];

                // Fill in missing fields from the new song if they are present and better
                if (!existingSong.albumArtUrl && song.albumArtUrl) {
                    existingSong.albumArtUrl = song.albumArtUrl;
                }
                if (!existingSong.durationMs && song.durationMs) {
                    existingSong.durationMs = song.durationMs;
                }
                // Keep existing title, artist, album as they are the primary match criteria
                // If ISRC matched, these should ideally be consistent.
            } else {
                finalResultsMap.set(key, { ...song }); // Add a copy to avoid modifying original objects in sortedResults
            }
        }

        return Array.from(finalResultsMap.values());
    }
}
