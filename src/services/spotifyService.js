import { SPOTIFY } from "../config.js";
import { FileUtils } from "../utils/fileUtils.js";
import { SimilarityUtils } from "../utils/similarityUtils.js";
import { spotifyAccountManager } from "../config.js";

const CACHE = {
    clientId: null,
    accessToken: null,
    spotifyToken: null,
    tokenExpiry: null
};

const SECRET_CIPHER_DICT_URL = "https://raw.githubusercontent.com/Thereallo1026/spotify-secrets/main/secrets/secretDict.json";

const FALLBACK_SECRETS = {
    "14": [62, 54, 109, 83, 107, 77, 41, 103, 45, 93, 114, 38, 41, 97, 64, 51, 95, 94, 95, 94],
    "13": [59, 92, 64, 70, 99, 78, 117, 75, 99, 103, 116, 67, 103, 51, 87, 63, 93, 59, 70, 45, 32],
    "12": [107, 81, 49, 57, 67, 93, 87, 81, 69, 67, 40, 93, 48, 50, 46, 91, 94, 113, 41, 108, 77, 107, 34],
};

const SECRET_CACHE = {
    dict: FALLBACK_SECRETS,
    lastUpdated: 0,
    updateInterval: 4 * 60 * 60 * 1000
};

const MAX_RETRIES = 3;

export class SpotifyService {

    // --- Public API Methods ---

    static async fetchLyrics(originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration, gd, forceReload) {
        let songTitle = originalSongTitle;
        let songArtist = originalSongArtist;
        let songAlbum = originalSongAlbum;
        let songDuration = originalSongDuration;

        try {
            const checkCache = async (title, artist, album, duration) => {
                const existingSpotifyFile = await FileUtils.findExistingSp(gd, title, artist, album, duration);
                if (!forceReload && existingSpotifyFile) {
                    try {
                        const jsonContent = await gd.fetchFile(existingSpotifyFile.id);
                        if (jsonContent) {
                            const parsed = JSON.parse(jsonContent);
                            const converted = this.convertSpotifyToJSON(parsed);
                            converted.cached = 'GDrive';
                            return {
                                success: true,
                                data: converted,
                                source: 'Spotify',
                                rawData: parsed,
                                existingFile: existingSpotifyFile
                            };
                        }
                    } catch (error) {
                        console.warn('Failed to fetch existing Spotify file from GDrive, will refetch.', error);
                    }
                }
                return null;
            };

            const initialCacheResult = await checkCache(songTitle, songArtist, songAlbum, songDuration);
            if (initialCacheResult) {
                console.debug('Spotify lyrics found in cache (initial check).');
                return initialCacheResult;
            }

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

            const spotifyTrack = spotifyTracks.find(t => t.id === bestMatch.candidate.id);
            if (!spotifyTrack) {
                console.warn('Matched Spotify track not found in original search results.');
                return null;
            }

            songTitle = spotifyTrack.name;
            songArtist = spotifyTrack.artists.map(a => a.name).join(', ');
            songAlbum = spotifyTrack.album.name;
            songDuration = spotifyTrack.duration_ms / 1000;

            console.debug(`Selected match: ${songArtist} - ${songTitle} (Album: ${songAlbum}, Duration: ${songDuration}s)`);

            const postSearchCacheResult = await checkCache(songTitle, songArtist, songAlbum, songDuration);
            if (postSearchCacheResult) {
                console.debug('Spotify lyrics found in cache (post-search check).');
                return postSearchCacheResult;
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
            convertedLyrics.cached = 'None';

            return {
                success: true,
                data: convertedLyrics,
                source: 'Spotify',
                rawData: spotifyLyrics,
                existingFile: null,
                exactMetadata: {
                    title: songTitle,
                    artist: songArtist,
                    album: songAlbum,
                    durationMs: songDuration * 1000
                }
            };
        } catch (error) {
            console.warn('Spotify lyrics fetch failed:', error);
            return null;
        }
    }

    static async searchSpotifySong(title, artist) {
        const searchQuery = `${encodeURIComponent(title)} artist:${encodeURIComponent(artist)}`;
        const response = await this.makeSpotifyRequest(
            `${SPOTIFY.BASE_URL}/search?q=${searchQuery}&type=track&limit=10`, {}
        );
        const data = await response.json();
        return data.tracks?.items?.length ? data.tracks.items : [];
    }

    static async fetchSpotifyLyrics(trackId) {
        const currentAccount = spotifyAccountManager.getCurrentAccount();
        if (!currentAccount) throw new Error("No Spotify account available for lyrics fetch.");

        const response = await this.makeSpotifyRequest(
            `${SPOTIFY.LYRICS_URL}${trackId}?format=json&vocalRemoval=false&market=from_token`, {
            headers: { "Cookie": currentAccount.COOKIE }
        }
        );
        return response.json();
    }

    /**
     * Fetches songwriters for a given Spotify track ID.
     * @param {string} trackId - The Spotify track ID.
     * @returns {Promise<string[]>} An array of songwriter names.
     */
    static async fetchSpotifySongwriters(trackId) {
        try {
            const currentAccount = spotifyAccountManager.getCurrentAccount();
            if (!currentAccount) throw new Error("No Spotify account available for fetching songwriters.");

            const url = `https://spclient.wg.spotify.com/track-credits-view/v0/experimental/${trackId}/credits`;
            const response = await this.makeSpotifyRequest(url, {
                headers: { "Cookie": currentAccount.COOKIE }
            });

            const data = await response.json();
            if (!data?.roleCredits) {
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
     * @returns {Promise<object>} The normalized song object.
     */
    static async normalizeSpotifySong(track) {
        const songwriters = await this.fetchSpotifySongwriters(track.id);
        const albumArtUrl = track.album.images.length > 0 ? track.album.images[0].url : null;
        const isrc = track.external_ids?.isrc || null;

        return {
            id: { spotify: track.id },
            sourceId: track.id,
            title: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            album: track.album.name,
            albumArtUrl: albumArtUrl,
            durationMs: track.duration_ms,
            isrc: isrc,
            songwriters: songwriters,
            availability: ['Spotify'],
            externalUrls: { spotify: track.external_urls.spotify }
        };
    }

    // --- Core Request & Authentication Logic ---

    static async makeSpotifyRequest(url, options = {}, retries = 0) {
        try {
            const currentAccount = spotifyAccountManager.getCurrentAccount();
            if (!currentAccount) throw new Error("No Spotify account available.");

            const headers = {
                "User-Agent": this.getRandomUserAgent(),
                ...options.headers,
            };

            if (url.includes(SPOTIFY.LYRICS_URL) || url.includes("track-credits-view")) {
                if (!headers.Authorization) {
                    const { accessToken } = await this.getSpotifyWebToken();
                    headers.Authorization = `Bearer ${accessToken}`;
                }
                if (!headers.Cookie) headers.Cookie = currentAccount.COOKIE;
                headers["app-platform"] = "WebPlayer";
            } else if (url.includes(SPOTIFY.AUTH_URL) || url.includes(SPOTIFY.BASE_URL)) {
                if (!headers.Authorization) {
                    const token = await this.getSpotifyAuth();
                    headers.Authorization = `Bearer ${token}`;
                }
            }

            const response = await fetch(url, { ...options, headers });

            if (!response.ok) {
                if ((response.status === 401 || response.status === 429) && retries < MAX_RETRIES) {
                    console.warn(`Spotify API call failed with status ${response.status}. Retrying with next account...`);
                    spotifyAccountManager.switchToNextAccount();
                    Object.assign(CACHE, { clientId: null, accessToken: null, spotifyToken: null, tokenExpiry: null });
                    return this.makeSpotifyRequest(url, options, retries + 1);
                }
                const errorText = await response.text();
                throw new Error(`Spotify API returned status ${response.status}: ${errorText}`);
            }
            return response;
        } catch (error) {
            console.error("Error in makeSpotifyRequest:", error);
            throw error;
        }
    }

    static async getSpotifyWebToken() {
        if (CACHE.accessToken && CACHE.tokenExpiry && Date.now() < CACHE.tokenExpiry) {
            return {
                clientId: CACHE.clientId,
                accessToken: CACHE.accessToken,
                expiry: CACHE.tokenExpiry
            };
        }

        const currentAccount = spotifyAccountManager.getCurrentAccount();
        if (!currentAccount) throw new Error("No Spotify account available for web token authentication.");

        try {
            const { totp, totpVer } = await this.generateSpotifyTOTP();
            const headers = {
                "Cookie": currentAccount.COOKIE || "",
                "User-Agent": this.getRandomUserAgent(),
                "app-platform": "WebPlayer",
                "Referer": "https://open.spotify.com/"
            };

            const transportParams = new URLSearchParams({ reason: 'transport', productType: 'web-player', totp, totpServer: totp, totpVer: totpVer.toString() });
            let response = await fetch(`https://open.spotify.com/api/token?${transportParams}`, { headers });

            if (!response.ok) {
                console.warn(`Token request with reason=transport failed (${response.status}). Retrying with reason=init.`);
                const initParams = new URLSearchParams({ reason: 'init', productType: 'web-player', totp, totpServer: totp, totpVer: totpVer.toString() });
                response = await fetch(`https://open.spotify.com/api/token?${initParams}`, { headers });
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to get Spotify web token after retries. Status: ${response.status}, Body: ${errorText}`);
            }

            const data = await response.json();
            if (!data.clientId || !data.accessToken) {
                console.debug("Spotify token response missing critical data:", data);
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


    static async getSpotifyAuth() {
        if (CACHE.spotifyToken && Date.now() < CACHE.tokenExpiry) {
            return CACHE.spotifyToken;
        }

        const currentAccount = spotifyAccountManager.getCurrentAccount();
        if (!currentAccount) {
            console.error("No Spotify account available for client credentials authentication.");
            return null;
        }

        try {
            const encoded = btoa(`${currentAccount.CLIENT_ID}:${currentAccount.CLIENT_SECRET}`);
            const response = await this.makeSpotifyRequest(SPOTIFY.AUTH_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${encoded}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'grant_type=client_credentials'
            }, 0);

            const data = await response.json();
            if (data.access_token) {
                CACHE.spotifyToken = data.access_token;
                CACHE.tokenExpiry = Date.now() + (data.expires_in * 1000);
                return CACHE.spotifyToken;
            } else {
                throw new Error("Failed to get Spotify token: access_token not in response.");
            }
        } catch (error) {
            console.error("Error fetching Spotify auth token:", error);
            return null;
        }
    }

    // --- TOTP & Secrets Management ---

    static async generateSpotifyTOTP() {
        const secrets = await this.getSecrets();
        const totpVer = Math.max(...Object.keys(secrets).map(Number));
        const secretCipherBytes = secrets[totpVer.toString()];

        if (!secretCipherBytes) throw new Error(`Secret for TOTP version ${totpVer} not found.`);

        const transformed = secretCipherBytes.map((e, t) => e ^ ((t % 33) + 9));
        const joined = transformed.join('');
        const derivedSecretBytes = new TextEncoder().encode(joined);

        const serverTimeResponse = await fetch("https://open.spotify.com/", { method: 'HEAD' });
        if (!serverTimeResponse.ok || !serverTimeResponse.headers.has('date')) {
            throw new Error(`Failed to fetch Spotify server time: ${serverTimeResponse.status}`);
        }
        const serverDate = serverTimeResponse.headers.get('date');
        const serverTimeSeconds = Math.floor(new Date(serverDate).getTime() / 1000);

        const totp = await this.generateTOTP(derivedSecretBytes, serverTimeSeconds);
        return { totp, totpVer };
    }

    static async generateTOTP(secretBytes, timestamp, digits = 6, interval = 30) {
        const counter = Math.floor(timestamp / interval);
        const counterBuffer = new ArrayBuffer(8);
        const view = new DataView(counterBuffer);
        view.setUint32(0, Math.floor(counter / Math.pow(2, 32)));
        view.setUint32(4, counter % Math.pow(2, 32));

        const hmac = await this.hmacSha1(secretBytes, new Uint8Array(counterBuffer));
        const offset = hmac[19] & 0x0f;
        const binary = ((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff);
        const otp = binary % Math.pow(10, digits);
        return otp.toString().padStart(digits, '0');
    }

    static async getSecrets() {
        if (Date.now() - SECRET_CACHE.lastUpdated > SECRET_CACHE.updateInterval) {
            await this.updateSecrets();
        }
        return SECRET_CACHE.dict;
    }

    static async updateSecrets() {
        console.debug("Attempting to update Spotify TOTP secrets...");
        try {
            const response = await fetch(SECRET_CIPHER_DICT_URL);
            if (!response.ok) throw new Error(`Failed to fetch secrets, status: ${response.status}`);

            const newSecrets = await response.json();
            if (typeof newSecrets === 'object' && Object.keys(newSecrets).length > 0) {
                SECRET_CACHE.dict = newSecrets;
                SECRET_CACHE.lastUpdated = Date.now();
                console.debug("Successfully updated Spotify TOTP secrets.");
            } else {
                throw new Error("Fetched secrets data is invalid.");
            }
        } catch (error) {
            console.warn(`Could not update Spotify secrets. Using cached/fallback version. Reason: ${error.message}`);
        }
    }

    static async hmacSha1(key, message) {
        const encoder = new TextEncoder();
        const keyData = typeof key === 'string' ? encoder.encode(key) : key;
        const messageData = typeof message === 'string' ? encoder.encode(message) : message;
        const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
        return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, messageData));
    }

    // --- Data Conversion & Processing ---

    static convertSpotifyToJSON(spotifyPayload) {
        const spotifyLyrics = spotifyPayload.lyrics || spotifyPayload;
        const songWriters = spotifyLyrics.songWriters || [];
        const hasDetailedTiming = spotifyLyrics.lines?.some(line => line.syllables && line.syllables.length > 0);
        const originalType = hasDetailedTiming ? "syllable" : "Line";
        const finalType = originalType === "syllable" ? "Word" : "Line";

        const result = {
            type: finalType,
            KpoeTools: "1.31R2-LPlusBcknd,1.31-LPlusBcknd",
            metadata: {
                source: spotifyLyrics.providerDisplayName,
                leadingSilence: "0.000",
                songWriters: songWriters
            },
            lyrics: []
        };

        if (originalType === "Line") {
            result.lyrics = (spotifyLyrics.lines || []).map((line, index) => ({
                time: Math.round(Number(line.startTimeMs)),
                duration: Math.round(Number(line.endTimeMs) || ((spotifyLyrics.lines[index + 1]?.startTimeMs - line.startTimeMs) || 0)),
                text: line.words,
                syllabus: [],
                element: {
                    key: line.syllables?.[0]?.verse || "",
                    songPart: this.detectSongPart(line),
                    singer: ""
                }
            })).filter(line => line.text && line.text !== '♪');
        } else {
            (spotifyLyrics.lines || []).forEach((line, index) => {
                if ((!line.words || line.words === '♪') && (!line.syllables || line.syllables.length === 0)) return;

                const currentLine = {
                    time: 0,
                    duration: 0,
                    text: "",
                    syllabus: [],
                    element: { key: `L${index + 1}`, songPart: this.detectSongPart(line), singer: "v1" }
                };

                if (line.syllables?.length > 0) {
                    line.syllables.forEach((syl, sylIndex) => {
                        if (syl.text === '') return;
                        const syllableText = syl.text + (this.shouldAddSpace(line.syllables, sylIndex) ? " " : "");
                        currentLine.text += syllableText;
                        currentLine.syllabus.push({
                            time: Math.round(Number(syl.startTimeMs)),
                            duration: Math.round(Number(syl.endTimeMs) || 500),
                            text: syllableText,
                        });
                    });

                    const earliestTime = currentLine.syllabus[0]?.time || 0;
                    const lastSyllable = currentLine.syllabus[currentLine.syllabus.length - 1];
                    const latestEndTime = (lastSyllable?.time || 0) + (lastSyllable?.duration || 0);

                    currentLine.time = earliestTime;
                    currentLine.duration = latestEndTime - earliestTime;
                    currentLine.text = currentLine.text.trim();
                    result.lyrics.push(currentLine);
                } else {
                    result.lyrics.push({
                        time: Math.round(Number(line.startTimeMs)),
                        duration: Math.round(Number(line.endTimeMs) || ((spotifyLyrics.lines[index + 1]?.startTimeMs - line.startTimeMs) || 0)),
                        text: line.words,
                        syllabus: [],
                        element: currentLine.element
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
        if (currentIndex >= syllables.length - 1) return false;
        const currentSyl = syllables[currentIndex];
        const nextSyl = syllables[currentIndex + 1];
        if (nextSyl.startTimeMs - currentSyl.endTimeMs > 100) return true;
        return nextSyl.text.match(/^[A-Z]/) || currentSyl.text.match(/[.,!?]$/) || nextSyl.text.match(/^[.,!?]/);
    }

    // --- Utilities ---

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
}