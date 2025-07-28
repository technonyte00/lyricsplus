// musixmatchService.js
import { DbHandler } from "../utils/DbHandler.js";
import { GDRIVE } from "../config.js";
import { SimilarityUtils } from "../utils/similarityUtils.js";
import { FileUtils } from "../utils/fileUtils.js";
import { SpotifyService } from "./spotifyService.js";

const MUSIXMATCH_BASE_URL = 'https://apic-desktop.musixmatch.com/ws/1.1';
const USER_AGENT = 'PostmanRuntime/7.33.0';
const TOKEN_KEY = 'musixmatch_token';


export class MusixmatchService {
    /**
     * Get a user token from Musixmatch
     * @param {object} env - Environment variables
     * @returns {Promise<string>} User token
     */
    static async getUserToken(env) {
        try {
            DbHandler.init(env.LYRICSPLUS);

            // Get the instance
            const kvHandler = DbHandler.getInstance();
            const storedToken = await kvHandler.get(TOKEN_KEY);

            if (storedToken && storedToken.expiryTime > Date.now()) {
                return storedToken.token;
            }

            const url = new URL(`${MUSIXMATCH_BASE_URL}/token.get`);
            url.searchParams.set('app_id', 'web-desktop-app-v1.0');

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'authority': 'apic-desktop.musixmatch.com',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
                    "Cookie": 'AWSELB=55578B011601B1EF8BC274C33F9043CA947F99DCFF0A80541772015CA2B39C35C0F9E1C932D31725A7310BCAEB0C37431E024E2B45320B7F2C84490C2C97351FDE34690157',
                    "Origin": 'musixmatch.com',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to get user token');
            }

            const data = await response.json();
            const token = data.message.body.user_token;

            // Validate token
            if (!token || token === 'UpgradeOnlyUpgradeOnlyUpgradeOnlyUpgradeOnly') {
                throw new Error('Invalid token received');
            }

            // Store token in KV with 1 hour expiry
            const tokenData = {
                token,
                expiryTime: Date.now() + 3600000 // 1 hour in milliseconds
            };
            await kvHandler.set(TOKEN_KEY, tokenData, 3600); // TTL in seconds

            return token;
        } catch (error) {
            console.error('Error getting user token:', error);
            throw error;
        }
    }

    /**
     * Search for a track on Musixmatch
     * @param {string} query - Search query
     * @param {string} userToken - User token
     * @returns {Promise<object>} Search results
     */
    static async searchTrack(query, userToken) {
        try {
            const url = new URL(`${MUSIXMATCH_BASE_URL}/track.search`);
            url.searchParams.set('app_id', 'web-desktop-app-v1.0');
            url.searchParams.set('page_size', '5');
            url.searchParams.set('f_has_lyrics', 'true')
            url.searchParams.set('usertoken', userToken);
            url.searchParams.set('page', '1');
            url.searchParams.set('q', query);

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'authority': 'apic-desktop.musixmatch.com',
                    "Cookie": 'AWSELB=55578B011601B1EF8BC274C33F9043CA947F99DCFF0A80541772015CA2B39C35C0F9E1C932D31725A7310BCAEB0C37431E024E2B45320B7F2C84490C2C97351FDE34690157',
                    "Origin": 'musixmatch.com',
                    'User-Agent': USER_AGENT,
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to search track');
            }

            return await response.json();
        } catch (error) {
            console.error('Error searching track:', error);
            throw error;
        }
    }

    /**
     * Normalizes a Musixmatch track object into the custom song catalog format.
     * @param {object} track - The Musixmatch track object (from track_list.track).
     * @returns {Promise<object>} The normalized song object.
     */
    static async normalizeMusixmatchSong(track, userToken) {
        let fullTrackDetails = track;
        let songwriters = [];
        let isrc = null;

        try {
            // Use advancedTrackSearch to get more details, including ISRC and potentially songwriters
            const advancedSearchParams = {
                q_track: track.track_name,
                q_artist: track.artist_name,
                q_album: track.album_name,
                track_id: track.track_id // Use track_id for direct lookup
            };
            const advancedResult = await this.advancedTrackSearch(advancedSearchParams, userToken);
            if (advancedResult?.message?.body?.track) {
                fullTrackDetails = advancedResult.message.body.track;
                isrc = fullTrackDetails.track_isrc || null;

                // Musixmatch often includes songwriters in the 'writer_list' or 'primary_genres'
                // Let's check for common patterns or specific fields
                if (fullTrackDetails.writer_list && fullTrackDetails.writer_list.length > 0) {
                    songwriters = fullTrackDetails.writer_list.map(writer => writer.writer_name);
                } else if (fullTrackDetails.credits?.writer_list && fullTrackDetails.credits.writer_list.length > 0) {
                    // Check if songwriters are available under a 'credits' object
                    songwriters = fullTrackDetails.credits.writer_list.map(writer => writer.writer_name);
                } else if (fullTrackDetails.primary_genres?.music_genre_list) {
                    // Fallback, less reliable
                }
            }
        } catch (error) {
            console.warn(`Failed to fetch advanced Musixmatch track details for ${track.track_name} by ${track.artist_name}:`, error);
        }

        const albumArtUrl = fullTrackDetails.album_coverart_100x100 || fullTrackDetails.album_coverart_350x350 || fullTrackDetails.album_coverart_500x500 || null;

        return {
            id: { musixmatch: fullTrackDetails.track_id }, // New ID structure
            sourceId: fullTrackDetails.track_id, // Individual service ID
            title: fullTrackDetails.track_name,
            artist: fullTrackDetails.artist_name,
            album: fullTrackDetails.album_name,
            albumArtUrl: albumArtUrl,
            durationMs: fullTrackDetails.track_length * 1000,
            isrc: isrc,
            songwriters: songwriters,
            availability: ['Musixmatch'], // New availability field
            externalUrls: {
                musixmatch: `https://www.musixmatch.com/lyrics/${encodeURIComponent(fullTrackDetails.artist_name)}/${encodeURIComponent(fullTrackDetails.track_name)}`
            }
        };
    }

    /**
     * Get lyrics for a track
     * @param {string} trackId - Track ID
     * @param {string} userToken - User token
     * @returns {Promise<object>} Lyrics data
     */
    static async getLyrics(trackId, userToken) {
        try {
            // First, try to get synced lyrics
            const subtitleUrl = new URL(`${MUSIXMATCH_BASE_URL}/track.subtitle.get`);
            subtitleUrl.searchParams.set('app_id', 'web-desktop-app-v1.0');
            subtitleUrl.searchParams.set('subtitle_format', 'id3');
            subtitleUrl.searchParams.set('usertoken', userToken);
            subtitleUrl.searchParams.set('track_id', trackId);

            const subtitleResponse = await fetch(subtitleUrl.toString(), {
                method: 'GET',
                headers: {
                    'authority': 'apic-desktop.musixmatch.com',
                    "Cookie": 'AWSELB=55578B011601B1EF8BC274C33F9043CA947F99DCFF0A80541772015CA2B39C35C0F9E1C932D31725A7310BCAEB0C37431E024E2B45320B7F2C84490C2C97351FDE34690157',
                    "Origin": 'musixmatch.com',
                    'User-Agent': USER_AGENT,
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Content-Type': 'application/json'
                }
            });

            if (!subtitleResponse.ok) {
                throw new Error('Failed to fetch subtitle');
            }

            const subtitleData = await subtitleResponse.json();

            // Check if subtitle exists
            if (subtitleData.message.body.subtitle) {
                return subtitleData;
            }

            // If no synced lyrics, try unsynced lyrics
            const unsyncedUrl = new URL(`${MUSIXMATCH_BASE_URL}/track.lyrics.get`);
            unsyncedUrl.searchParams.set('app_id', 'web-desktop-app-v1.0');
            unsyncedUrl.searchParams.set('subtitle_format', 'id3');
            unsyncedUrl.searchParams.set('usertoken', userToken);
            unsyncedUrl.searchParams.set('track_id', trackId);

            const unsyncedResponse = await fetch(unsyncedUrl.toString(), {
                method: 'GET',
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Content-Type': 'application/json'
                }
            });

            if (!unsyncedResponse.ok) {
                throw new Error('Failed to fetch unsynced lyrics');
            }

            return await unsyncedResponse.json();
        } catch (error) {
            console.error('Error getting lyrics:', error);
            throw error;
        }
    }

    /**
     * Get richsync for a track
     * @param {string} trackId - Track ID
     * @param {string} userToken - User token
     * @returns {Promise<object>} Lyrics data
     */
    static async getRichLyrics(trackId, userToken) {
        try {
            // First, try to get synced lyrics
            const subtitleUrl = new URL(`${MUSIXMATCH_BASE_URL}/track.richsync.get`);
            subtitleUrl.searchParams.set('app_id', 'web-desktop-app-v1.0');
            subtitleUrl.searchParams.set('usertoken', userToken);
            subtitleUrl.searchParams.set('track_id', trackId);

            const subtitleResponse = await fetch(subtitleUrl.toString(), {
                method: 'GET',
                headers: {
                    'authority': 'apic-desktop.musixmatch.com',
                    "Cookie": 'AWSELB=55578B011601B1EF8BC274C33F9043CA947F99DCFF0A80541772015CA2B39C35C0F9E1C932D31725A7310BCAEB0C37431E024E2B45320B7F2C84490C2C97351FDE34690157',
                    "Origin": 'musixmatch.com',
                    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
                    "upgrade-insecure-requests": "1",
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Content-Type': 'application/json'
                }
            });

            if (!subtitleResponse.ok) {
                throw new Error('Failed to fetch subtitle');
            }

            const subtitleData = await subtitleResponse.json();
            return subtitleData;
        } catch (error) {
            console.error('Error getting lyrics:', error);
            throw error;
        }
    }

    /**
     * Get translated lyrics for a track
     * @param {string} trackId - Track ID
     * @param {string} userToken - User token
     * @param {string} language - Target language code
     * @returns {Promise<object>} Translated lyrics data
     */
    static async translateLyrics(trackId, userToken, language) {
        try {
            const apiUrl = new URL('https://apic.musixmatch.com/ws/1.1/crowd.track.translations.get');
            apiUrl.searchParams.set('translation_fields_set', 'minimal');
            apiUrl.searchParams.set('track_id', trackId);
            apiUrl.searchParams.set('selected_language', language);
            apiUrl.searchParams.set('comment_format', 'text');
            apiUrl.searchParams.set('part', 'user');
            apiUrl.searchParams.set('format', 'json');
            apiUrl.searchParams.set('usertoken', userToken);
            apiUrl.searchParams.set('app_id', 'web-desktop-app-v1.0');
            apiUrl.searchParams.set('tags', 'playing');

            const response = await fetch(apiUrl.toString(), {
                method: 'GET',
                headers: {
                    'authority': 'apic-desktop.musixmatch.com',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
                    "Cookie": 'AWSELB=55578B011601B1EF8BC274C33F9043CA947F99DCFF0A80541772015CA2B39C35C0F9E1C932D31725A7310BCAEB0C37431E024E2B45320B7F2C84490C2C97351FDE34690157',
                    "Origin": 'musixmatch.com',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch translated lyrics');
            }

            return await response.json();
        } catch (error) {
            console.error('Error translating lyrics:', error);
            throw error;
        }
    }

    /**
     * Perform an advanced track search with more parameters
     * @param {object} params - Search parameters
     * @param {string} userToken - User token
     * @returns {Promise<object>} Search results
     */
    static async advancedTrackSearch(params, userToken) {
        try {
            const apiUrl = new URL('https://apic-desktop.musixmatch.com/ws/1.1/matcher.track.get');

            // Default parameters
            const defaultParams = {
                'tags': 'scrobbling%2Cnotifications',
                'subtitle_format': 'dfxp',
                'page_size': '5',
                'questions_id_list': 'track_esync_action%2Ctrack_sync_action%2Ctrack_translation_action%2Clyrics_ai_mood_analysis_v3',
                'optional_calls': 'track.richsync%2Ccrowd.track.actions',
                'app_id': 'web-desktop-app-v1.0',
                'country': 'us',
                'part': 'lyrics_crowd%2Cuser%2Clyrics_vote%2Clyrics_poll%2Ctrack_lyrics_translation_status%2Clyrics_verified_by%2Clabels%2Ctrack_structure%2Ctrack_performer_tagging%2Ctrack_isrc%2Cwriter_list%2Ccredits', // Added track_isrc, writer_list, and credits
                'language_iso_code': '1',
                'format': 'json'
            };

            // Merge default and provided parameters
            const mergedParams = { ...defaultParams, ...params };

            // Add parameters to URL
            Object.entries(mergedParams).forEach(([key, value]) => {
                apiUrl.searchParams.set(key, value);
            });

            // Add userToken
            apiUrl.searchParams.set('usertoken', userToken);

            const response = await fetch(apiUrl.toString(), {
                method: 'GET',
                headers: {
                    'authority': 'apic-desktop.musixmatch.com',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
                    "Cookie": 'AWSELB=55578B011601B1EF8BC274C33F9043CA947F99DCFF0A80541772015CA2B39C35C0F9E1C932D31725A7310BCAEB0C37431E024E2B45320B7F2C84490C2C97351FDE34690157',
                    "Origin": 'musixmatch.com',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to perform advanced track search');
            }

            return await response.json();
        } catch (error) {
            console.error('Error in advanced track search:', error);
            throw error;
        }
    }

    /**
 * Fetch lyrics from Musixmatch with caching support
 * @param {string} songTitle - Song title
 * @param {string} songArtist - Song artist
 * @param {string} songAlbum - Song album
 * @param {number} songDuration - Song duration
 * @param {object} gd - Google Drive API instance
 * @param {boolean} forceReload - Force reload from API
 * @param {object} env - Environment variables
 * @returns {Promise<object>} Lyrics data
 */
    static async fetchLyrics(originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration, gd, forceReload, env, requireWordSync = false) {
        let songTitle = originalSongTitle;
        let songArtist = originalSongArtist;
        let songAlbum = originalSongAlbum;
        let songDuration = originalSongDuration;

        let userToken = null;
        let bestMatch = null;
        let matchedTrack = null;

        try {
            userToken = await this.getUserToken(env);
            if (!userToken) {
                console.warn('Failed to get Musixmatch user token');
                return null;
            }

            // Try multiple search strategies
            const searchQueries = [
                [originalSongTitle, originalSongArtist, originalSongAlbum].filter(Boolean).join(' '),
                [originalSongTitle, originalSongArtist].filter(Boolean).join(' '),
                [originalSongArtist, originalSongAlbum].filter(Boolean).join(' '),
                originalSongTitle,
            ];

            let candidates = [];

            for (const query of searchQueries) {
                console.debug('Searching Musixmatch with query:', query);
                const searchResults = await this.searchTrack(query, userToken);

                if (!searchResults?.message?.header) {
                    console.warn('Invalid Musixmatch search response');
                    continue;
                }

                if (searchResults.message.header.status_code === 401) {
                    console.warn('Unauthorized Musixmatch access when searching');
                    return null;
                }

                const trackResults = searchResults.message.body.track_list || [];

                if (trackResults.length > 0) {
                    // Map tracks to the match format expected by findBestSongMatch
                    const currentCandidates = trackResults
                        .filter(result => result && result.track)
                        .map(result => ({
                            attributes: {
                                name: result.track.track_name,
                                artistName: result.track.artist_name,
                                albumName: result.track.album_name,
                                durationInMillis: result.track.track_length * 1000
                            },
                            originalTrack: result.track // Keep reference to original track object
                        }));
                    candidates.push(...currentCandidates);

                    bestMatch = SimilarityUtils.findBestSongMatch(candidates, originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration);
                    if (bestMatch) {
                        // Find the corresponding original track result
                        matchedTrack = candidates.find(c =>
                            c.attributes.name === bestMatch.candidate.attributes.name &&
                            c.attributes.artistName === bestMatch.candidate.attributes.artistName
                        )?.originalTrack;
                        if (matchedTrack) break;
                    }
                }
            }

            if (!bestMatch || !matchedTrack) {
                console.warn('No suitable track match found in Musixmatch results');
                return null;
            }

            // Update song metadata with exact details from the best match
            songTitle = matchedTrack.track_name;
            songArtist = matchedTrack.artist_name;
            songAlbum = matchedTrack.album_name;
            songDuration = matchedTrack.track_length; // Musixmatch provides duration in seconds

            console.debug(`Selected match: ${songArtist} - ${songTitle} (Album: ${songAlbum}, Duration: ${songDuration}s)`);

            // Check existing Musixmatch cache using updated metadata
            const existingMusixmatchFile = await FileUtils.findExistingMusixmatch(gd, songTitle, songArtist, songAlbum, songDuration);

            // Use cached file if available and not forcing a reload
            if (!forceReload && existingMusixmatchFile) {
                try {
                    const jsonContent = await gd.fetchFile(existingMusixmatchFile.id);
                    if (jsonContent) {
                        const parsedContent = JSON.parse(jsonContent);
                        const convertedToJson = this.convertMusixmatchToJSON(parsedContent, requireWordSync);
                        if (!requireWordSync || convertedToJson.type === "Word") {
                            convertedToJson.cached = 'GDrive';
                            return { success: true, data: convertedToJson, source: 'Musixmatch', rawData: parsedContent, existingFile: existingMusixmatchFile };
                        }
                    }
                } catch (error) {
                    console.warn('Failed to fetch existing Musixmatch file:', error);
                }
            }

            const trackId = matchedTrack.track_id;

            let lyricsResult = null;
            let lyricsType = null;

            // Always try to get richsync lyrics first
            try {
                const richLyrics = await MusixmatchService.getRichLyrics(trackId, userToken);
                if (richLyrics?.message?.body?.richsync) {
                    lyricsResult = richLyrics;
                    lyricsType = 'richsync';
                }
            } catch (error) {
                console.warn('Failed to fetch richsync lyrics:', error);
            }

            // If richsync failed and word sync is not strictly required, try to get subtitle lyrics
            if (!lyricsResult && !requireWordSync) {
                try {
                    const subtitleLyrics = await MusixmatchService.getLyrics(trackId, userToken);
                    if (subtitleLyrics?.message?.body?.subtitle) {
                        lyricsResult = subtitleLyrics;
                        lyricsType = 'subtitle';
                    }
                } catch (error) {
                    console.warn('Failed to fetch subtitle lyrics:', error);
                }
            }

            if (lyricsResult) {
                const musixmatchData = {
                    track: matchedTrack,
                    lyrics: lyricsResult,
                    type: lyricsType // Add type to distinguish between richsync and subtitle
                };

                // Convert and cache the Musixmatch data
                const convertedLyrics = this.convertMusixmatchToJSON(musixmatchData, requireWordSync);

                if (!convertedLyrics) {
                    console.warn('Failed to convert Musixmatch data to LyricsPlus format.');
                    return null;
                }

                // If word sync is required, ensure the converted lyrics are of type "Word"
                if (requireWordSync && convertedLyrics.type !== "Word") {
                    console.warn('Musixmatch richsync not available for this track, and word sync was required.');
                    return null;
                }

                convertedLyrics.cached = existingMusixmatchFile ? 'Updated' : 'None';
                return {
                    success: true,
                    data: convertedLyrics,
                    source: 'Musixmatch',
                    rawData: musixmatchData,
                    existingFile: existingMusixmatchFile,
                    exactMetadata: {
                        title: songTitle,
                        artist: songArtist,
                        album: songAlbum,
                        durationMs: songDuration * 1000 // Convert to milliseconds for consistency
                    }
                };
            }
        } catch (error) {
            console.warn('Musixmatch lyrics fetch failed:', error);
        }

        return null;
    }



    static parseSubtitleLyrics(subtitleBody) {
        /**
         * Parse subtitle body into LyricsPlus format lyrics
         * 
         * @param {string} subtitleBody - Subtitle body from Musixmatch
         * @returns {Array} List of lyric line dictionaries
         */
        const lyrics = [];
        const lines = subtitleBody.split('\n');

        lines.forEach((line, index) => {
            if (line.includes('[') && line.includes(']')) {
                // Extract time and text
                const timeStr = line.substring(1, 9);
                const [minutes, seconds] = timeStr.split(':').map(parseFloat);
                const totalMs = Math.floor((minutes * 60 + seconds) * 1000);

                // Extract text (everything after the timestamp)
                const text = line.substring(10).trim();

                if (text) {
                    // Calculate duration to next line or set to a default
                    const nextLine = lines[index + 1] ? lines[index + 1] : null;
                    let duration = 3000; // Default duration of 3 seconds

                    if (nextLine && nextLine.includes('[')) {
                        const nextTimeStr = nextLine.substring(1, 9);
                        const [nextMinutes, nextSeconds] = nextTimeStr.split(':').map(parseFloat);
                        const nextTotalMs = Math.floor((nextMinutes * 60 + nextSeconds) * 1000);
                        duration = nextTotalMs - totalMs;
                    }

                    lyrics.push({
                        time: totalMs,
                        duration: duration,
                        text: text,
                        isLineEnding: 1,
                        element: {
                            key: "",
                            songPart: "",
                            singer: ""
                        }
                    });
                }
            }
        });

        return lyrics.filter(line => line.text.trim() !== '');

    }

    static parseRichsyncLyrics(richsyncBody, wordLevel = false) {
        /**
         * Parse richsync body into LyricsPlus format lyrics (word-level or line-level)
         * 
         * @param {string} richsyncBody - Richsync body from Musixmatch (JSON string)
         * @param {boolean} wordLevel - Whether to return word-level timing (true) or line-level (false)
         * @returns {Array} List of lyric word/line dictionaries
         */
        const lyrics = [];
        try {
            const richsyncData = JSON.parse(richsyncBody);
            richsyncData.forEach((lineData) => {
                const lineStartTimeMs = Math.floor(lineData.ts * 1000);
                const lineEndTimeMs = Math.floor(lineData.te * 1000);
                const words = lineData.l; // Array of word/syllable objects

                if (!wordLevel) {
                    // Line-level: Create one entry per line
                    if (lineData.x) {
                        lyrics.push({
                            time: lineStartTimeMs,
                            duration: lineEndTimeMs - lineStartTimeMs,
                            text: lineData.x,
                            isLineEnding: 1,
                            element: { key: "", songPart: "", singer: "" }
                        });
                    }
                    return;
                }

                // Word-level processing
                if (!words || words.length === 0) {
                    // If no words but there's a line text, add it as a single word
                    if (lineData.x) {
                        lyrics.push({
                            time: lineStartTimeMs,
                            duration: lineEndTimeMs - lineStartTimeMs,
                            text: lineData.x,
                            isLineEnding: 1,
                            element: { key: "", songPart: "", singer: "" }
                        });
                    }
                    return;
                }

                // Process individual words/syllables, merging words with their trailing spaces
                let i = 0;
                while (i < words.length) {
                    const wordData = words[i];
                    let wordText = wordData.c;

                    // Skip if this is just a space (will be handled by previous word)
                    if (wordText.trim() === '') {
                        i++;
                        continue;
                    }

                    // Check if next element is a space and merge it
                    if (i + 1 < words.length && words[i + 1].c.trim() === '') {
                        wordText += words[i + 1].c; // Add the space
                        i += 2; // Skip both current word and space
                    } else {
                        i++; // Just move to next word
                    }

                    const wordOffsetMs = Math.floor(wordData.o * 1000);
                    const wordStartTimeMs = lineStartTimeMs + wordOffsetMs;

                    let duration;
                    // Find next actual word (not space) for duration calculation
                    let nextWordIndex = i;
                    while (nextWordIndex < words.length && words[nextWordIndex].c.trim() === '') {
                        nextWordIndex++;
                    }

                    if (nextWordIndex < words.length) {
                        const nextElementOffsetMs = Math.floor(words[nextWordIndex].o * 1000);
                        duration = (lineStartTimeMs + nextElementOffsetMs) - wordStartTimeMs;
                    } else {
                        // Last word in line: duration until line ends
                        duration = lineEndTimeMs - wordStartTimeMs;
                    }

                    // Ensure duration is positive and reasonable
                    if (duration <= 0) {
                        duration = 100; // Minimum 100ms duration
                    }

                    const isLastWord = nextWordIndex >= words.length;

                    lyrics.push({
                        time: wordStartTimeMs,
                        duration: duration,
                        text: wordText,
                        isLineEnding: isLastWord ? 1 : 0,
                        element: { key: "", songPart: "", singer: "" }
                    });
                }
            });
        } catch (error) {
            console.error('Error parsing richsync body:', error);
            return [];
        }

        // Filter out any empty text entries and sort by time
        return lyrics
            .filter(line => line.text && line.text.trim() !== '')
            .sort((a, b) => a.time - b.time);
    }


    static convertMusixmatchToJSON(musixmatchData, requireWordSync = false) {
        /**
         * Convert Musixmatch JSON format to LyricsPlus format
         * 
         * @param {Object} musixmatchData - Musixmatch JSON data
         * @param {boolean} requireWordSync - Whether word-level sync is required
         * @returns {Object} LyricsPlus format JSON
         */
        const trackInfo = musixmatchData.track;
        let lyricsContent = [];
        let lyricsCopyright = '';
        let lyricsType = "Line"; // Default to Line type

        if (musixmatchData.lyrics?.message?.body?.richsync) {
            const richsyncInfo = musixmatchData.lyrics.message.body.richsync;
            // Pass requireWordSync as wordLevel parameter
            lyricsContent = this.parseRichsyncLyrics(richsyncInfo.richsync_body, requireWordSync);
            lyricsCopyright = richsyncInfo.lyrics_copyright;
            // Set type based on whether word sync was requested AND successfully parsed
            if (requireWordSync && lyricsContent.length > 0) {
                // Check if we actually have word-level data (short text entries)
                const hasWordLevelData = lyricsContent.some(item =>
                    item.text.trim().split(/\s+/).length === 1 || item.text.length < 20
                );
                lyricsType = hasWordLevelData ? "Word" : "Line";
            } else {
                lyricsType = "Line";
            }
        } else if (musixmatchData.lyrics?.message?.body?.subtitle) {
            const subtitleInfo = musixmatchData.lyrics.message.body.subtitle;
            lyricsContent = this.parseSubtitleLyrics(subtitleInfo.subtitle_body);
            lyricsCopyright = subtitleInfo.lyrics_copyright;
            lyricsType = "Line";
        } else {
            console.warn("Unsupported Musixmatch data format or missing lyrics body", musixmatchData);
            return null;
        }

        return {
            type: lyricsType,
            KpoeTools: "1.31-LPlusBcknd",
            metadata: {
                source: "Musixmatch",
                songWriters: lyricsCopyright
                    ? this._extractSongwriters(lyricsCopyright)
                    : [],
                leadingSilence: "0.000"
            },
            lyrics: lyricsContent
        };
    }

    static _extractSongwriters(copyrightString) {
        /**
         * Extract songwriter names from copyright string
         * 
         * @param {string} copyrightString - Copyright string from Musixmatch
         * @returns {string[]} Array of songwriter names
         */
        if (!copyrightString) return [];

        // Common copyright string formats include "Writer(s): Name1, Name2"
        const writerMatch = copyrightString.match(/Writer\(s\):\s*([^\n]+)/i);
        if (writerMatch) {
            return writerMatch[1].split(',').map(name => name.trim());
        }

        return [];
    }
}
