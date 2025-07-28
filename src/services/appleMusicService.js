// services/appleMusicService.js

const CACHE = { storefront: null, authToken: null };
import { APPLE_MUSIC, GDRIVE } from "../config.js";
import { convertTTMLtoJSON } from "../utils/mapHandler.js";
import { SimilarityUtils } from "../utils/similarityUtils.js";
import { FileUtils } from "../utils/fileUtils.js";
import { LyricsPlusService } from "./lyricsPlusService.js";
import GoogleDrive from "../utils/googleDrive.js";

const gd = new GoogleDrive();

export class AppleMusicService {
    static async getAppleMusicAuth() {
        if (APPLE_MUSIC.AUTH_TYPE === "android") {
            return APPLE_MUSIC.ANDROID_AUTH_TOKEN;
        }

        if (!CACHE.authToken) {
            try {
                const response = await fetch("https://music.apple.com/");
                const html = await response.text();
                const scriptTagMatch = html.match(/<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"><\/script>/);

                if (!scriptTagMatch?.[1]) {
                    throw new Error("Apple Music script tag not found");
                }

                const scriptUrl = new URL(scriptTagMatch[1], "https://music.apple.com/").toString();
                const jsResponse = await fetch(scriptUrl);
                const jsContent = await jsResponse.text();

                const authorizationMatch = jsContent.match(/e\.headers\.Authorization\s*=\s*`Bearer \${(.*?)}`/);
                if (!authorizationMatch?.[1]) {
                    throw new Error("Authorization token variable not found");
                }

                const variableName = authorizationMatch[1];
                const variableMatch = jsContent.match(new RegExp(`const ${variableName}\\s*=\\s*"([^"]+)"`));

                if (!variableMatch?.[1]) {
                    throw new Error("Authorization token value not found");
                }

                CACHE.authToken = variableMatch[1];
            } catch (error) {
                console.error("Error fetching Apple Music auth token:", error);
                return null;
            }
        }
        return CACHE.authToken;
    }

    static async getStorefront() {
        if (!CACHE.storefront) {
            const token = await this.getAppleMusicAuth();
            const headers = APPLE_MUSIC.AUTH_TYPE === "android" ? {
                Authorization: `Bearer ${token}`,
                "x-dsid": APPLE_MUSIC.ANDROID_DSID,
                "User-Agent": APPLE_MUSIC.ANDROID_USER_AGENT,
                "Cookie": APPLE_MUSIC.ANDROID_COOKIE,
                "Accept-Encoding": "gzip"
            } : {
                Authorization: `Bearer ${token}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                Origin: 'https://music.apple.com',
                Referer: 'https://music.apple.com',
                'media-user-token': APPLE_MUSIC.MUSIC_AUTH_TOKEN
            };

            const storefrontResponse = await fetch("https://api.music.apple.com/v1/me/storefront", {
                headers: headers,
            });
            try {
                const storefrontData = await storefrontResponse.json();
                CACHE.storefront = storefrontData.data[0].id;
            } catch (err) {
                console.debug("using default storeid");
                CACHE.storefront = "us";
            }
        }
        return CACHE.storefront;
    }

    static async saveSongs(updatedSongs) {
      // Save songs to Google Drive
      const content = typeof updatedSongs === "string" ? updatedSongs : JSON.stringify(updatedSongs, null, 0);
      await gd.updateFile(GDRIVE.SONGS_FILE_ID, content);
    }

    static async searchSong(query, dev_token, storefront) {
        if (!query) return { results: { songs: { data: [] } } };

        const headers = APPLE_MUSIC.AUTH_TYPE === "android" ? {
            Authorization: `Bearer ${dev_token}`,
            "x-dsid": APPLE_MUSIC.ANDROID_DSID,
            "User-Agent": APPLE_MUSIC.ANDROID_USER_AGENT,
            "Cookie": APPLE_MUSIC.ANDROID_COOKIE,
            "Accept-Encoding": "gzip"
        } : {
            Authorization: `Bearer ${dev_token}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            "media-user-token": APPLE_MUSIC.MUSIC_AUTH_TOKEN,
            Origin: 'https://music.apple.com',
            Referer: 'https://music.apple.com',
        };

        const response = await fetch(
            `${APPLE_MUSIC.BASE_URL}/catalog/${storefront}/search?types=songs&term=${encodeURIComponent(query)}`,
            {
                headers: headers,
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Apple Music API returned status ${response.status}: ${errorText}`);
        }

        return response.json();
    }

    /**
     * Fetches ISRC for a given Apple Music song ID.
     * Apple Music API does not directly provide ISRC in search results,
     * so we need to fetch the full song details.
     * @param {string} songId - The Apple Music song ID.
     * @param {string} dev_token - The developer token.
     * @param {string} storefront - The storefront ID.
     * @returns {Promise<string|null>} The ISRC code or null if not found.
     */
    static async fetchIsrc(songId, dev_token, storefront) {
        try {
            const headers = APPLE_MUSIC.AUTH_TYPE === "android" ? {
                Authorization: `Bearer ${dev_token}`,
                "x-dsid": APPLE_MUSIC.ANDROID_DSID,
                "User-Agent": APPLE_MUSIC.ANDROID_USER_AGENT,
                "Cookie": APPLE_MUSIC.ANDROID_COOKIE,
                "Accept-Encoding": "gzip"
            } : {
                Authorization: `Bearer ${dev_token}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                "media-user-token": APPLE_MUSIC.MUSIC_AUTH_TOKEN,
                Origin: 'https://music.apple.com',
                Referer: 'https://music.apple.com',
            };

            const response = await fetch(
                `${APPLE_MUSIC.BASE_URL}/catalog/${storefront}/songs/${songId}`,
                {
                    headers: headers,
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch Apple Music song details for ISRC with status ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data.data?.[0]?.attributes || null; // Return full attributes
        } catch (error) {
            console.error("Error fetching Apple Music song details:", error);
            return null;
        }
    }

    /**
     * Normalizes an Apple Music track object into the custom song catalog format.
     * @param {object} track - The Apple Music track object.
     * @param {string} dev_token - The developer token (needed for ISRC fetch).
     * @param {string} storefront - The storefront ID (needed for ISRC fetch).
     * @returns {Promise<object>} The normalized song object.
     */
    static async normalizeAppleMusicSong(track, dev_token, storefront) {
        const attributes = track.attributes;
        const albumArtUrl = attributes.artwork?.url ? attributes.artwork.url.replace('{w}', '300').replace('{h}', '300') : null;

        // Fetch full song details to get ISRC and potentially more attributes like songwriters
        const fullSongAttributes = await this.fetchIsrc(track.id, dev_token, storefront);
        const isrc = fullSongAttributes?.isrc || null;
        const songwriters = fullSongAttributes?.songwriterNames || attributes.songwriterNames || []; // Prioritize full details, then search results

        return {
            id: { appleMusic: track.id }, // New ID structure
            sourceId: track.id, // Individual service ID
            title: attributes.name,
            artist: attributes.artistName,
            album: attributes.albumName,
            albumArtUrl: albumArtUrl,
            durationMs: attributes.durationInMillis,
            isrc: isrc,
            songwriters: songwriters,
            availability: ['Apple Music'], // New availability field
            externalUrls: {
                appleMusic: attributes.url
            }
        };
    }

    static async fetchLyrics(originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration, songs, gd, forceReload, sources) {
        let songTitle = originalSongTitle;
        let songArtist = originalSongArtist;
        let songAlbum = originalSongAlbum;
        let songDuration = originalSongDuration;

        let bestMatch = null;
        let dev_token = null;
        let storefront = null;

        try {
            dev_token = await this.getAppleMusicAuth();
            storefront = await this.getStorefront();

            const searchQueries = [
                [originalSongTitle, originalSongArtist, originalSongAlbum].filter(Boolean).join(' '),
                [originalSongTitle, originalSongArtist].filter(Boolean).join(' '),
                `${originalSongArtist} ${originalSongTitle}`,
                originalSongTitle
            ];

            let candidates = [];

            for (const query of searchQueries) {
                console.debug(`Searching Apple Music with query: "${query}"`);
                const searchData = await this.searchSong(query, dev_token, storefront);
                const newCandidates = searchData.results?.songs?.data || [];
                candidates.push(...newCandidates);

                bestMatch = SimilarityUtils.findBestSongMatch(candidates, originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration);
                if (bestMatch) break;
            }

            if (!bestMatch) {
                console.warn('No suitable candidates found in Apple Music search');
                return null;
            }

            // Update song metadata with exact details from the best match
            const firstResult = bestMatch.candidate;
            songTitle = firstResult.attributes.name;
            songArtist = firstResult.attributes.artistName;
            songAlbum = firstResult.attributes.albumName || null;
            songDuration = firstResult.attributes.durationInMillis / 1000;

            console.debug(`Selected match: ${songArtist} - ${songTitle} (Album: ${songAlbum}, Duration: ${songDuration}s)`);

            // Find matching song in local cache using updated metadata
            let song = songs.find(
                s => s && s.track_name?.toLowerCase() === songTitle?.toLowerCase() &&
                    s.artist?.toLowerCase() === songArtist?.toLowerCase() &&
                    (!songAlbum || s.album?.toLowerCase() === songAlbum?.toLowerCase()) &&
                    (!songDuration || !s.duration || Math.abs(s.duration - songDuration) <= 3)
            );

            // Find existing file for update if needed using updated metadata
            let existingFile = await FileUtils.findExistingTTML(gd, songTitle, songArtist, songAlbum, songDuration);

            // Use DB cache if available and not forcing reload
            if (!forceReload && song?.ttmlFileId) {
                try {
                    const ttmlContent = await gd.fetchFile(song.ttmlFileId.id);
                    if (ttmlContent) {
                        const convertedToJson = convertTTMLtoJSON(ttmlContent);
                        if (!convertedToJson.lyrics || convertedToJson.lyrics.length === 0) {
                            console.warn('Cached lyrics are empty, attempting to refetch');
                        } else {
                            convertedToJson.metadata = convertedToJson.metadata || {};
                            convertedToJson.metadata.source = 'Apple';
                            convertedToJson.cached = 'Database';

                            // Check if Lyrics+ is preferred for non-syllable lyrics
                            if (sources.includes('lyricsplus') && !FileUtils.hasSyllableSync(convertedToJson)) {
                                const alt = await LyricsPlusService.fetchLyrics(songTitle, songArtist, songAlbum, songDuration, gd);
                                if (alt?.success) return alt;
                            }

                            return { success: true, data: convertedToJson, source: 'apple', rawData: ttmlContent, existingFile: song.ttmlFileId };
                        }
                    }
                } catch (error) {
                    console.warn('Failed to fetch existing TTML, will try to refetch lyrics:', error);
                }
            }

            // Use GDrive cache if available and not forcing reload
            if (!forceReload && existingFile) {
                try {
                    const ttmlContent = await gd.fetchFile(existingFile.id);
                    if (ttmlContent) {
                        // Store in local database if not already there
                        if (!song) {
                            song = {
                                artist: songArtist,
                                track_name: songTitle,
                                album: songAlbum,
                                ttmlFileId: existingFile,
                                source: 'Apple',
                            };
                            songs.push(song);
                            await this.saveSongs(songs);
                        }

                        const convertedToJson = convertTTMLtoJSON(ttmlContent);
                        convertedToJson.metadata = convertedToJson.metadata || {};
                        convertedToJson.metadata.source = 'Apple';
                        convertedToJson.cached = 'GDrive';

                        // Check if Lyrics+ is on preferred for non-syllable lyrics
                        if (sources.includes('lyricsplus') && !FileUtils.hasSyllableSync(convertedToJson)) {
                            const alt = await LyricsPlusService.fetchLyrics(songTitle, songArtist, songAlbum, songDuration, gd);
                            if (alt?.success) return alt;
                        }

                        return { success: true, data: convertedToJson, source: 'apple', rawData: ttmlContent, existingFile: existingFile };
                    }
                } catch (error) {
                    console.warn('Failed to fetch existing file, will try to refetch lyrics:', error);
                }
            }

            // Fetch syllable lyrics using the exact matched song ID
            const lyricsResponse = await fetch(
                `${APPLE_MUSIC.BASE_URL}/catalog/${storefront}/songs/${firstResult.id}/syllable-lyrics`,
                {
                    headers: APPLE_MUSIC.AUTH_TYPE === "android" ? {
                        Authorization: `Bearer ${dev_token}`,
                        "x-dsid": APPLE_MUSIC.ANDROID_DSID,
                        "User-Agent": APPLE_MUSIC.ANDROID_USER_AGENT,
                        "Cookie": APPLE_MUSIC.ANDROID_COOKIE,
                        "Accept-Encoding": "gzip"
                    } : {
                        Authorization: `Bearer ${dev_token}`,
                        Origin: 'https://music.apple.com',
                        Referer: 'https://music.apple.com',
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                        'media-user-token': APPLE_MUSIC.MUSIC_AUTH_TOKEN,
                    },
                }
            );

            if (!lyricsResponse.ok) {
                console.warn(`Failed to fetch lyrics: ${lyricsResponse.status}`);
                return null;
            }

            const lyricsData = await lyricsResponse.json();
            const lyrics = lyricsData.data?.[0]?.attributes?.ttml;

            if (lyrics) {
                // Generate filename using exact metadata from the matched song
                const fileName = await FileUtils.generateUniqueFileName(
                    songTitle,
                    songArtist,
                    songAlbum,
                    songDuration
                );

                // Return converted data
                const convertedToJson = convertTTMLtoJSON(lyrics);
                if (!convertedToJson.lyrics || convertedToJson.lyrics.length === 0) {
                    console.warn('Fetched lyrics are empty');
                    return null;
                } else {
                    convertedToJson.metadata = convertedToJson.metadata || {};
                    convertedToJson.metadata.source = 'Apple';
                    convertedToJson.cached = existingFile ? 'Updated' : 'None';
                    convertedToJson.metadata.appleMusicId = firstResult.id; // Add Apple Music ID to metadata
                    return {
                        success: true,
                        data: convertedToJson,
                        source: 'apple',
                        rawData: lyrics,
                        existingFile: existingFile,
                        exactMetadata: {
                            title: songTitle,
                            artist: songArtist,
                            album: songAlbum,
                            durationMs: songDuration * 1000 // Convert back to milliseconds for consistency
                        }
                    };
                }
            }
        } catch (error) {
            console.warn('Failed to check Apple Music:', error);
        }
        return null;
    }
}
