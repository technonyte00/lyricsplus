import { SPOTIFY, GDRIVE } from "../config.js";
import { FileUtils } from "../utils/fileUtils.js";
import { SimilarityUtils } from "../utils/similarityUtils.js";

// Constants for Caching
const CACHE = {
    clientId: null,
    accessToken: null,
    spotifyToken: null,
    tokenExpiry: null
};

// URL to fetch the latest secrets from.
const SECRET_CIPHER_DICT_URL = "https://raw.githubusercontent.com/Thereallo1026/spotify-secrets/main/secrets/secretDict.json";

// The hardcoded dictionary acts as a fallback if the remote fetch fails.
const FALLBACK_SECRETS = {
    "14": [62, 54, 109, 83, 107, 77, 41, 103, 45, 93, 114, 38, 41, 97, 64, 51, 95, 94, 95, 94],
    "13": [59, 92, 64, 70, 99, 78, 117, 75, 99, 103, 116, 67, 103, 51, 87, 63, 93, 59, 70, 45, 32],
    "12": [107, 81, 49, 57, 67, 93, 87, 81, 69, 67, 40, 93, 48, 50, 46, 91, 94, 113, 41, 108, 77, 107, 34],
};

// Cache for the dynamically fetched secrets to avoid fetching on every request.
const SECRET_CACHE = {
    dict: FALLBACK_SECRETS,
    lastUpdated: 0,
    updateInterval: 4 * 60 * 60 * 1000 // Update every 4 hours
};


export class SpotifyService {
    constructor() {
        // The original constructor was empty but might be used later.
        // It's good practice to keep it if it was there.
        // The global CACHE object is used instead of a `this.CACHE` instance property.
    }

    static async updateSecrets() {
        console.debug("Attempting to update Spotify TOTP secrets...");
        try {
            const response = await fetch(SECRET_CIPHER_DICT_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch secrets, status: ${response.status}`);
            }
            const newSecrets = await response.json();
            if (typeof newSecrets === 'object' && Object.keys(newSecrets).length > 0) {
                SECRET_CACHE.dict = newSecrets;
                SECRET_CACHE.lastUpdated = Date.now();
                console.debug("Successfully updated Spotify TOTP secrets.");
            } else {
                throw new Error("Fetched secrets data is invalid.");
            }
        } catch (error) {
            console.warn(`Could not update Spotify secrets. Will use cached/fallback version. Reason: ${error.message}`);
        }
    }

    static async getSecrets() {
        const now = Date.now();
        if (now - SECRET_CACHE.lastUpdated > SECRET_CACHE.updateInterval) {
            await this.updateSecrets();
        }
        return SECRET_CACHE.dict;
    }


    // HMAC-SHA1 implementation
    static async hmacSha1(key, message) {
        const encoder = new TextEncoder();
        const keyData = typeof key === 'string' ? encoder.encode(key) : key;
        const messageData = typeof message === 'string' ? encoder.encode(message) : message;

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign']
        );

        return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, messageData));
    }

    // TOTP generation (simplified to match PHP implementation)
    static async generateTOTP(secretBytes, timestamp, digits = 6, interval = 30) {
        const counter = Math.floor(timestamp / interval);

        const counterBuffer = new ArrayBuffer(8);
        const view = new DataView(counterBuffer);
        const high = Math.floor(counter / Math.pow(2, 32));
        const low = counter % Math.pow(2, 32);
        view.setUint32(0, high);
        view.setUint32(4, low);

        const hmac = await this.hmacSha1(secretBytes, new Uint8Array(counterBuffer));

        const offset = hmac[19] & 0x0f;

        const binary = ((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff);

        const otp = binary % Math.pow(10, digits);
        return otp.toString().padStart(digits, '0');
    }

    // Generate Spotify TOTP
    static async generateSpotifyTOTP() {
        const secrets = await this.getSecrets();
        const totpVer = Math.max(...Object.keys(secrets).map(Number));
        const secretCipherBytes = secrets[totpVer.toString()];

        if (!secretCipherBytes) {
            throw new Error(`Secret for TOTP version ${totpVer} not found.`);
        }

        const transformed = secretCipherBytes.map((e, t) => e ^ ((t % 33) + 9));
        const joined = transformed.join('');
        const encoder = new TextEncoder();
        const derivedSecretBytes = encoder.encode(joined);

        const serverTimeResponse = await fetch("https://open.spotify.com/", { method: 'HEAD' });
        if (!serverTimeResponse.ok || !serverTimeResponse.headers.has('date')) {
            throw new Error(`Failed to fetch Spotify server time: ${serverTimeResponse.status}`);
        }
        const serverDate = serverTimeResponse.headers.get('date');
        const serverTimeSeconds = Math.floor(new Date(serverDate).getTime() / 1000);

        const totp = await this.generateTOTP(derivedSecretBytes, serverTimeSeconds);
        return { totp, totpVer };
    }

    // Get Spotify Web Token
    static async getSpotifyWebToken() {
        try {
            const { totp, totpVer } = await this.generateSpotifyTOTP();

            const spDcCookie = this.extractSpDcCookie(SPOTIFY.COOKIE || "");
            if (!spDcCookie) {
                console.warn("Warning: sp_dc cookie not found in provided cookies. This might lead to authentication issues.");
            }

            const userAgent = this.getRandomUserAgent();
            const headers = {
                "Cookie": SPOTIFY.COOKIE || "",
                "User-Agent": userAgent,
                "app-platform": "WebPlayer",
                "Referer": "https://open.spotify.com/"
            };

            const baseUrl = "https://open.spotify.com/api/token";

            const transportParams = new URLSearchParams({
                reason: 'transport',
                productType: 'web-player',
                totp,
                totpServer: totp,
                totpVer: totpVer.toString(),
            });

            let response = await fetch(`${baseUrl}?${transportParams}`, { headers });

            if (!response.ok) {
                console.warn(`Token request with reason=transport failed (${response.status}). Retrying with reason=init.`);
                const initParams = new URLSearchParams({
                    reason: 'init',
                    productType: 'web-player',
                    totp,
                    totpServer: totp,
                    totpVer: totpVer.toString(),
                });
                response = await fetch(`${baseUrl}?${initParams}`, { headers });
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Spotify web token request failed with status ${response.status}: ${errorText}`);
                throw new Error(`Failed to get Spotify web tokens: ${response.status} ${response.statusText}. Response: ${errorText.substring(0, 200)}...`);
            }

            const data = await response.json();

            if (!data.clientId || !data.accessToken) {
                console.debug("Spotify token response missing clientId or accessToken:", data);
                throw new Error("Failed to get Spotify web tokens: Invalid response structure.");
            }

            CACHE.clientId = data.clientId;
            CACHE.accessToken = data.accessToken;
            CACHE.tokenExpiry = new Date(data.accessTokenExpirationTimestampMs);

            return {
                clientId: data.clientId,
                accessToken: data.accessToken,
                expiry: CACHE.tokenExpiry
            };
        } catch (error) {
            console.error("Error fetching Spotify web tokens:", error);
            throw error;
        }
    }

    // Spotify Authentication Token
    static async getSpotifyAuth() {
        if (!CACHE.spotifyToken || Date.now() >= CACHE.tokenExpiry) {
            try {
                const encoded = btoa(`${SPOTIFY.CLIENT_ID}:${SPOTIFY.CLIENT_SECRET}`);
                const response = await fetch(SPOTIFY.AUTH_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${encoded}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: 'grant_type=client_credentials'
                });

                const data = await response.json();
                if (data.access_token) {
                    CACHE.spotifyToken = data.access_token;
                    CACHE.tokenExpiry = Date.now() + (data.expires_in * 1000);
                } else {
                    throw new Error("Failed to get Spotify token");
                }
            } catch (error) {
                console.error("Error fetching Spotify auth token:", error);
                return null;
            }
        }
        return CACHE.spotifyToken;
    }

    // Fetch Spotify Lyrics
    static async fetchSpotifyLyrics(trackId) {
        try {
            if (!CACHE.accessToken || (CACHE.tokenExpiry && Date.now() >= CACHE.tokenExpiry)) {
                await this.getSpotifyWebToken();
            }

            const response = await fetch(
                `${SPOTIFY.LYRICS_URL}${trackId}?format=json&vocalRemoval=false&market=from_token`, {
                    headers: {
                        "app-platform": "WebPlayer",
                        "Authorization": `Bearer ${CACHE.accessToken}`,
                        "Cookie": SPOTIFY.COOKIE,
                        "User-Agent": this.getRandomUserAgent()
                    }
                }
            );

            if (!response.ok) {
                if (response.status === 401) {
                    await this.getSpotifyWebToken();
                    return this.fetchSpotifyLyrics(trackId);
                }
                throw new Error(`Failed to fetch lyrics: ${response.status}`);
            }

            return response.json();
        } catch (error) {
            console.error("Error fetching Spotify lyrics:", error);
            throw error;
        }
    }

    // Search Spotify Song
    static async searchSpotifySong(title, artist) {
        const token = await this.getSpotifyAuth();
        const searchQuery = `${encodeURIComponent(title)} artist:${encodeURIComponent(artist)}`;
        const response = await fetch(
            `${SPOTIFY.BASE_URL}/search?q=${searchQuery}&type=track&limit=10`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Spotify search failed with status ${response.status}: ${errorText}`);
            return [];
        }

        const data = await response.json();
        if (!data.tracks?.items?.length) {
            return [];
        }
        return data.tracks.items;
    }

    /**
     * Fetches songwriters for a given Spotify track ID.
     * @param {string} trackId - The Spotify track ID.
     * @returns {Promise<string[]>} An array of songwriter names.
     */
    static async fetchSpotifySongwriters(trackId) {
        try {
            if (!CACHE.accessToken || (CACHE.tokenExpiry && Date.now() >= CACHE.tokenExpiry)) {
                await this.getSpotifyWebToken();
            }

            const url = `https://spclient.wg.spotify.com/track-credits-view/v0/experimental/${trackId}/credits`;
            const response = await fetch(url, {
                headers: {
                    "app-platform": "WebPlayer",
                    "Authorization": `Bearer ${CACHE.accessToken}`,
                    "Cookie": SPOTIFY.COOKIE,
                    "User-Agent": this.getRandomUserAgent()
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    await this.getSpotifyWebToken();
                    return this.fetchSpotifySongwriters(trackId);
                }
                throw new Error(`Failed to fetch songwriters: ${response.status}`);
            }

            const data = await response.json();
            if (!data || !data.roleCredits) {
                console.warn("Spotify track credits response missing roleCredits:", data);
                return [];
            }
            const writersRole = data.roleCredits.find(role => role.roleTitle?.toLowerCase() === 'writers');
            return writersRole ? writersRole.artists.map(artist => artist.name) : [];
        } catch (error) {
            console.error("Error fetching Spotify songwriters:", error);
            return [];
        }
    }

    /**
     * Normalizes a Spotify track object into the custom song catalog format.
     * @param {object} track - The Spotify track object.
     * @returns {object} The normalized song object.
     */
    static async normalizeSpotifySong(track) {
        const songwriters = await this.fetchSpotifySongwriters(track.id);
        const albumArtUrl = track.album.images.length > 0 ? track.album.images[0].url : null;
        const isrc = track.external_ids?.isrc || null;

        return {
            id: { spotify: track.id }, // New ID structure
            sourceId: track.id, // Individual service ID
            title: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            album: track.album.name,
            albumArtUrl: albumArtUrl,
            durationMs: track.duration_ms,
            isrc: isrc,
            songwriters: songwriters,
            availability: ['Spotify'], // New availability field
            externalUrls: {
                spotify: track.external_urls.spotify
            }
        };
    }

    // Utility Functions
    static extractSpDcCookie(cookieString) {
        const match = cookieString.split("; ").find(c => c.trim().startsWith("sp_dc="));
        return match ? match.trim() : null;
    }

    static getRandomUserAgent() {
        const userAgents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0"
        ];
        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

    // --- Spotify lyrics fetcher ---
    static async fetchLyrics(originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration, gd, forceReload) {
        let songTitle = originalSongTitle;
        let songArtist = originalSongArtist;
        let songAlbum = originalSongAlbum;
        let songDuration = originalSongDuration;

        let spotifyTrack = null;

        try {
            const spotifyTracks = await this.searchSpotifySong(originalSongTitle, originalSongArtist);
            if (!spotifyTracks || spotifyTracks.length === 0) {
                console.warn('No Spotify tracks found for search query.');
                return null;
            }

            const bestMatch = SimilarityUtils.findBestSongMatch(
                spotifyTracks.map(track => ({
                    attributes: {
                        name: track.name,
                        artistName: track.artists.map(a => a.name).join(', '),
                        albumName: track.album.name,
                        durationInMillis: track.duration_ms
                    },
                    id: track.id
                })),
                originalSongTitle,
                originalSongArtist,
                originalSongAlbum,
                originalSongDuration
            );

            if (!bestMatch) {
                console.warn('No suitable Spotify track match found.');
                return null;
            }

            spotifyTrack = spotifyTracks.find(t => t.id === bestMatch.candidate.id);
            if (!spotifyTrack) {
                console.warn('Matched Spotify track not found in original search results.');
                return null;
            }

            // Update song metadata with exact details from the best match
            songTitle = spotifyTrack.name;
            songArtist = spotifyTrack.artists.map(a => a.name).join(', ');
            songAlbum = spotifyTrack.album.name;
            songDuration = spotifyTrack.duration_ms / 1000;

            console.debug(`Selected match: ${songArtist} - ${songTitle} (Album: ${songAlbum}, Duration: ${songDuration}s)`);

            const existingSpotifyFile = await FileUtils.findExistingSp(gd, songTitle, songArtist, songAlbum, songDuration);

            if (!forceReload && existingSpotifyFile) {
                try {
                    const jsonContent = await gd.fetchFile(existingSpotifyFile.id);
                    if (jsonContent) {
                        const parsed = JSON.parse(jsonContent);
                        const converted = this.convertSpotifyToJSON(parsed);
                        converted.cached = 'GDrive';
                        return { success: true, data: converted, source: 'Spotify', rawData: parsed, existingFile: existingSpotifyFile };
                    }
                } catch (error) {
                    console.warn('Failed to fetch existing Spotify file:', error);
                }
            }

            const spotifyLyrics = await this.fetchSpotifyLyrics(spotifyTrack.id);
            if (!spotifyLyrics?.lyrics) {
                console.warn('No lyrics found for Spotify track.');
                return null;
            }

            try {
                spotifyLyrics.lyrics.songWriters = await this.fetchSpotifySongwriters(spotifyTrack.id);
            } catch (error) {
                console.warn('Failed to fetch songwriters for lyrics:', error);
                spotifyLyrics.lyrics.songWriters = [];
            }

            const convertedLyrics = this.convertSpotifyToJSON(spotifyLyrics);

            // Generate filename using exact metadata from the matched song
            const fileName = await FileUtils.generateUniqueFileName(
                songTitle,
                songArtist,
                songAlbum,
                songDuration
            );

            convertedLyrics.cached = existingSpotifyFile ? 'Updated' : 'None';
            return {
                success: true,
                data: convertedLyrics,
                source: 'Spotify',
                rawData: spotifyLyrics,
                existingFile: existingSpotifyFile,
                exactMetadata: {
                    title: songTitle,
                    artist: songArtist,
                    album: songAlbum,
                    durationMs: songDuration * 1000 // Convert back to milliseconds for consistency
                }
            };
        } catch (error) {
            console.warn('Spotify lyrics fetch failed:', error);
            return null;
        }
    }

    static convertSpotifyToJSON(spotifyPayload) {
        // If lyrics property exists, use it instead of the root object
        const spotifyLyrics = spotifyPayload.lyrics || spotifyPayload;
        const songWriters = spotifyLyrics.songWriters || [];

        // Determine if any line contains syllable-level timing
        const hasDetailedTiming = spotifyLyrics.lines?.some(line => line.syllables && line.syllables.length > 0);
        const type = hasDetailedTiming ? "syllable" : "Line";

        const result = {
            type,
            KpoeTools: "1.31-LPlusBcknd",
            metadata: {
                source: spotifyLyrics.providerDisplayName,
                leadingSilence: "0.000", // Spotify doesn't provide this
                songWriters: songWriters
            },
            lyrics: []
        };

        if (type === "Line") {
            // Process line-level timing
            result.lyrics = (spotifyLyrics.lines || []).map((line, index) => ({
                time: Math.round(Number(line.startTimeMs)),
                duration: Math.round(
                    Number(line.endTimeMs) ||
                    ((spotifyLyrics.lines[index + 1] &&
                        Number(spotifyLyrics.lines[index + 1].startTimeMs) - Number(line.startTimeMs)) ||
                        0)
                ),
                text: line.words,
                isLineEnding: 1,
                element: {
                    key: line.syllables && line.syllables.length > 0 ? line.syllables[0].verse : "",
                    songPart: this.detectSongPart(line),
                    singer: ""
                }
            })).filter(line => (line.text !== '' && line.text !== '♪'));
        } else {
            // Process syllable-level timing (bubub, this is for you)
            (spotifyLyrics.lines || []).forEach((line, index) => {
                // Skip empty lines
                if ((line.words === '' || line.words === '♪') && (!line.syllables || line.syllables.length === 0)) {
                    return;
                }

                const lineKey = `L${index + 1}`;
                const songPart = this.detectSongPart(line);

                if (line.syllables && line.syllables.length > 0) {
                    // Process each syllable
                    line.syllables.forEach((syl, sylIndex) => {
                        if (syl.text === '') return; // Skip empty syllable

                        result.lyrics.push({
                            time: Math.round(Number(syl.startTimeMs)),
                            duration: Math.round(
                                Number(syl.endTimeMs) ||
                                (Number(syl.startTimeMs) + 500 - Number(syl.startTimeMs))
                            ),
                            text: syl.text + (this.shouldAddSpace(line.syllables, sylIndex) ? " " : ""),
                            // If not the last syllable in the line, isLineEnding is 0
                            isLineEnding: sylIndex === line.syllables.length - 1 ? 1 : 0,
                            element: {
                                key: lineKey,
                                songPart: songPart,
                                singer: "v1"
                            }
                        });
                    });
                } else {
                    // Fallback to line-level timing if no syllables available
                    result.lyrics.push({
                        time: Math.round(Number(line.startTimeMs)),
                        duration: Math.round(
                            Number(line.endTimeMs) ||
                            ((spotifyLyrics.lines[index + 1] &&
                                Number(spotifyLyrics.lines[index + 1].startTimeMs) - Number(line.startTimeMs)) ||
                                0)
                        ),
                        text: line.words,
                        isLineEnding: 1,
                        element: {
                            key: lineKey,
                            songPart: songPart,
                            singer: "v1"
                        }
                    });
                }
            });
        }

        return result;
    }

    static detectSongPart(line) {
        const text = line.words.toLowerCase();
        if (text.includes("[verse]") || text.includes("verse")) return "Verse";
        if (text.includes("[chorus]") || text.includes("chorus")) return "Chorus";
        if (text.includes("[bridge]") || text.includes("bridge")) return "Bridge";
        if (text.includes("[intro]") || text.includes("intro")) return "Intro";
        if (text.includes("[outro]") || text.includes("outro")) return "Outro";
        return "";
    }

    static shouldAddSpace(syllables, currentIndex) {
        if (currentIndex === syllables.length - 1) return false;
        const currentSyl = syllables[currentIndex];
        const nextSyl = syllables[currentIndex + 1];

        // Add space if there's a significant time gap between syllables
        const timeGap = nextSyl.startTimeMs - currentSyl.endTimeMs;
        if (timeGap > 100) return true;

        // Add space if the next syllable starts a new word
        return nextSyl.text.match(/^[A-Z]/) || // Starts with capital letter
            currentSyl.text.match(/[.,!?]$/) || // Current ends with punctuation
            nextSyl.text.match(/^[.,!?]/); // Next starts with punctuation
    }
}
