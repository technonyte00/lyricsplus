import { DbHandler } from "../utils/DbHandler.js";
import { SimilarityUtils } from "../utils/similarityUtils.js";
import { FileUtils } from "../utils/fileUtils.js";

const MUSIXMATCH_BASE_URL = 'https://apic-desktop.musixmatch.com/ws/1.1';
const USER_AGENT = 'PostmanRuntime/7.33.0';
const TOKEN_KEY = 'musixmatch_token';
const DEFAULT_COOKIE = 'AWSELB=55578B011601B1EF8BC274C33F9043CA947F99DCFF0A80541772015CA2B39C35C0F9E1C932D31725A7310BCAEB0C37431E024E2B45320B7F2C84490C2C97351FDE34690157';

export class MusixmatchService {

    // --- Public API ---

    static async fetchLyrics(originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration, gd, forceReload, env, requireWordSync = false) {
        try {
            const userToken = await this.getUserToken(env);
            if (!userToken) throw new Error('Failed to get Musixmatch user token.');

            const initialCache = await this._checkCache(originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration, gd, forceReload, requireWordSync);
            if (initialCache) {
                console.debug('Musixmatch lyrics found in cache (initial check).');
                return initialCache;
            }

            const matchedTrack = await this._searchForBestMatch(originalSongTitle, originalSongArtist, originalSongAlbum, originalSongDuration, userToken);
            if (!matchedTrack) {
                console.warn('No suitable track match found in Musixmatch.');
                return null;
            }

            const { track_name, artist_name, album_name, track_length } = matchedTrack;
            const exactMetadata = { title: track_name, artist: artist_name, album: album_name, durationMs: track_length * 1000 };
            console.debug(`Selected match: ${artist_name} - ${track_name} (Album: ${album_name}, Duration: ${track_length}s)`);

            const postSearchCache = await this._checkCache(track_name, artist_name, album_name, track_length, gd, forceReload, requireWordSync);
            if (postSearchCache) {
                console.debug('Musixmatch lyrics found in cache (post-search check).');
                return postSearchCache;
            }

            const lyricsResult = await this._fetchLyricsFromApi(matchedTrack.track_id, userToken, requireWordSync);
            if (!lyricsResult) return null;

            const musixmatchData = { track: matchedTrack, ...lyricsResult };
            const convertedLyrics = this.convertMusixmatchToJSON(musixmatchData, requireWordSync);
            if (!convertedLyrics) {
                console.warn('Failed to convert Musixmatch data to standard format.');
                return null;
            }

            if (requireWordSync && convertedLyrics.type !== "Word") {
                console.warn('Richsync was required but not available for this track.');
                return null;
            }

            convertedLyrics.cached = 'None';
            return { success: true, data: convertedLyrics, source: 'Musixmatch', rawData: musixmatchData, existingFile: null, exactMetadata };

        } catch (error) {
            console.warn('Musixmatch lyrics fetch failed:', error);
            return null;
        }
    }

    static async searchTrack(query, userToken) {
        const url = new URL(`${MUSIXMATCH_BASE_URL}/track.search`);
        url.searchParams.set('page_size', '5');
        url.searchParams.set('f_has_lyrics', 'true');
        url.searchParams.set('page', '1');
        url.searchParams.set('q', query);
        return this._makeRequest(url, userToken);
    }

    static async normalizeMusixmatchSong(track, userToken) {
        let fullTrackDetails = track;
        let songwriters = [];
        let isrc = null;

        try {
            const advancedResult = await this.advancedTrackSearch({ q_track: track.track_name, q_artist: track.artist_name, q_album: track.album_name }, userToken);
            const advancedTrack = advancedResult?.message?.body?.track;
            if (advancedTrack) {
                fullTrackDetails = advancedTrack;
                isrc = advancedTrack.track_isrc || null;
                const writerList = advancedTrack.writer_list || advancedTrack.credits?.writer_list || [];
                songwriters = writerList.map(writer => writer.writer_name);
            }
        } catch (error) {
            console.warn(`Failed to fetch advanced details for ${track.track_name}:`, error);
        }
        
        const art = fullTrackDetails.album_coverart_100x100 || fullTrackDetails.album_coverart_350x350 || fullTrackDetails.album_coverart_500x500 || null;
        return {
            id: { musixmatch: fullTrackDetails.track_id },
            sourceId: fullTrackDetails.track_id,
            title: fullTrackDetails.track_name,
            artist: fullTrackDetails.artist_name,
            album: fullTrackDetails.album_name,
            albumArtUrl: art,
            durationMs: fullTrackDetails.track_length * 1000,
            isrc: isrc,
            songwriters: songwriters,
            availability: ['Musixmatch'],
            externalUrls: { musixmatch: `https://www.musixmatch.com/lyrics/${encodeURIComponent(fullTrackDetails.artist_name)}/${encodeURIComponent(fullTrackDetails.track_name)}` }
        };
    }

    // --- Core API Endpoints ---

    static getLyrics(trackId, userToken) {
        const url = new URL(`${MUSIXMATCH_BASE_URL}/track.lyrics.get`);
        url.searchParams.set('track_id', trackId);
        return this._makeRequest(url, userToken);
    }

    static getSubtitle(trackId, userToken) {
        const url = new URL(`${MUSIXMATCH_BASE_URL}/track.subtitle.get`);
        url.searchParams.set('subtitle_format', 'lrc');
        url.searchParams.set('track_id', trackId);
        return this._makeRequest(url, userToken);
    }

    static getRichLyrics(trackId, userToken) {
        const url = new URL(`${MUSIXMATCH_BASE_URL}/track.richsync.get`);
        url.searchParams.set('track_id', trackId);
        return this._makeRequest(url, userToken);
    }

    static translateLyrics(trackId, userToken, language) {
        const url = new URL(`${MUSIXMATCH_BASE_URL}/crowd.track.translations.get`);
        url.searchParams.set('translation_fields_set', 'minimal');
        url.searchParams.set('selected_language', language);
        url.searchParams.set('track_id', trackId);
        return this._makeRequest(url, userToken);
    }

    static advancedTrackSearch(params, userToken) {
        const url = new URL(`${MUSIXMATCH_BASE_URL}/matcher.track.get`);
        const defaultParams = {
            'subtitle_format': 'dfxp',
            'optional_calls': 'track.richsync',
            'part': 'lyrics_crowd,user,lyrics_vote,track_lyrics_translation_status,lyrics_verified_by,labels,track_isrc,writer_list,credits'
        };
        const mergedParams = { ...defaultParams, ...params };
        Object.entries(mergedParams).forEach(([key, value]) => url.searchParams.set(key, value));
        return this._makeRequest(url, userToken);
    }

    // --- Authentication & Token Management ---

    static async getUserToken(env) {
        try {
            DbHandler.init(env.LYRICSPLUS);
            const kvHandler = DbHandler.getInstance();
            const storedToken = await kvHandler.get(TOKEN_KEY);
            if (storedToken?.expiryTime > Date.now()) return storedToken.token;

            const data = await this._makeRequest(new URL(`${MUSIXMATCH_BASE_URL}/token.get`));
            const token = data.message?.body?.user_token;
            if (!token || token.includes('UpgradeOnly')) throw new Error('Invalid token received from Musixmatch.');

            await kvHandler.set(TOKEN_KEY, { token, expiryTime: Date.now() + 3600000 }, 3600);
            return token;
        } catch (error) {
            console.error('Error getting user token:', error);
            throw error;
        }
    }

    // --- Data Parsing & Conversion ---

    static convertMusixmatchToJSON(musixmatchData, requireWordSync = false) {
        let v1Lyrics = [], lyricsCopyright = '', lyricsType = "Line";

        if (musixmatchData.lyrics?.message?.body?.richsync) {
            const richsync = musixmatchData.lyrics.message.body.richsync;
            v1Lyrics = this.parseRichsyncLyrics(richsync.richsync_body, requireWordSync);
            lyricsCopyright = richsync.lyrics_copyright;
            lyricsType = requireWordSync ? "Word" : "Line";
        } else if (musixmatchData.lyrics?.message?.body?.subtitle) {
            const subtitle = musixmatchData.lyrics.message.body.subtitle;
            v1Lyrics = this.parseSubtitleLyrics(subtitle.subtitle_body);
            lyricsCopyright = subtitle.lyrics_copyright;
        } else {
            return null;
        }

        const groupedLyrics = (lyricsType === "Word") ? this._groupWordsIntoLines(v1Lyrics) : v1Lyrics;

        return {
            type: lyricsType,
            KpoeTools: "1.31R2-LPlusBcknd,1.31-LPlusBcknd",
            metadata: {
                source: "Musixmatch",
                songWriters: this._extractSongwriters(lyricsCopyright),
                leadingSilence: "0.000"
            },
            lyrics: groupedLyrics
        };
    }

    static parseSubtitleLyrics(subtitleBody) {
        return subtitleBody.split('\n').map((line, index, lines) => {
            const match = line.match(/\[(\d{2}):(\d{2}\.\d{2})\](.*)/);
            if (!match) return null;

            const [, minutes, seconds, text] = match;
            const time = Math.round((parseInt(minutes, 10) * 60 + parseFloat(seconds)) * 1000);

            let duration = 3000;
            const nextLine = lines[index + 1];
            if (nextLine) {
                const nextMatch = nextLine.match(/\[(\d{2}):(\d{2}\.\d{2})\]/);
                if (nextMatch) {
                    const nextTime = Math.round((parseInt(nextMatch[1], 10) * 60 + parseFloat(nextMatch[2])) * 1000);
                    duration = nextTime - time;
                }
            }
            return { time, duration, text: text.trim(), element: {} };
        }).filter(line => line.text.trim() !== '');
    }

    static parseRichsyncLyrics(richsyncBody, wordLevel = false) {
        try {
            const richsyncData = JSON.parse(richsyncBody);
            const lyrics = [];
            richsyncData.forEach(lineData => {
                const lineStart = Math.round(lineData.ts * 1000);
                const lineEnd = Math.round(lineData.te * 1000);
                if (wordLevel) {
                    lineData.l.forEach((word, i, words) => {
                        const wordStart = lineStart + Math.round(word.o * 1000);
                        const nextWord = words[i + 1];
                        const wordEnd = nextWord ? lineStart + Math.round(nextWord.o * 1000) : lineEnd;
                        lyrics.push({ time: wordStart, duration: wordEnd - wordStart, text: word.c, isLineEnding: !nextWord });
                    });
                } else {
                    lyrics.push({ time: lineStart, duration: lineEnd - lineStart, text: lineData.x, isLineEnding: true, element: {} });
                }
            });
            return lyrics;
        } catch (error) {
            console.error('Error parsing richsync body:', error);
            return [];
        }
    }

    static _groupWordsIntoLines(wordLyrics) {
        const lines = [];
        let currentLine = null;
        wordLyrics.forEach(word => {
            if (!currentLine) {
                currentLine = { time: word.time, text: "", syllabus: [], element: {} };
            }
            currentLine.text += word.text;
            currentLine.syllabus.push({ time: word.time, duration: word.duration, text: word.text });
            if (word.isLineEnding) {
                const firstWord = currentLine.syllabus[0];
                const lastWord = currentLine.syllabus[currentLine.syllabus.length - 1];
                currentLine.duration = (lastWord.time + lastWord.duration) - firstWord.time;
                lines.push(currentLine);
                currentLine = null;
            }
        });
        if (currentLine && currentLine.text.trim() != "") lines.push(currentLine);
        return lines;
    }

    // --- Internal Helpers ---

    static async _makeRequest(url, userToken = null) {
        url.searchParams.set('app_id', 'web-desktop-app-v1.0');
        if (userToken) url.searchParams.set('usertoken', userToken);

        const response = await fetch(url.toString(), {
            headers: {
                'authority': 'apic-desktop.musixmatch.com',
                'User-Agent': USER_AGENT,
                'Cookie': DEFAULT_COOKIE,
                'Origin': 'https://musixmatch.com',
            }
        });
        if (!response.ok) throw new Error(`Musixmatch API request failed with status ${response.status}`);
        const data = await response.json();
        if (data.message.header.status_code !== 200) throw new Error(`Musixmatch API error: ${data.message.header.hint || 'Unknown error'}`);
        return data;
    }
    
    static _extractSongwriters(copyrightString) {
        if (!copyrightString) return [];
        const match = copyrightString.match(/Writer\(s\):\s*([^\n]+)/i);
        return match ? match[1].split(',').map(name => name.trim()) : [];
    }

    static async _checkCache(title, artist, album, duration, gd, forceReload, requireWordSync) {
        if (forceReload) return null;
        const file = await FileUtils.findExistingMusixmatch(gd, title, artist, album, duration);
        if (file) {
            try {
                const content = await gd.fetchFile(file.id);
                if (content) {
                    const parsed = JSON.parse(content);
                    const converted = this.convertMusixmatchToJSON(parsed, requireWordSync);
                    if (converted && (!requireWordSync || converted.type === "Word")) {
                        converted.cached = 'GDrive';
                        return { success: true, data: converted, source: 'Musixmatch', rawData: parsed, existingFile: file };
                    }
                }
            } catch (error) {
                console.warn('Failed to process Musixmatch cache file:', error);
            }
        }
        return null;
    }

    static async _searchForBestMatch(title, artist, album, duration, userToken) {
        const queries = [
            `${title} ${artist}`,
            title
        ];
        let candidates = [];
        for (const query of queries) {
            const searchResults = await this.searchTrack(query, userToken);
            const tracks = searchResults.message?.body?.track_list || [];
            if (tracks.length > 0) {
                candidates.push(...tracks.map(t => ({
                    attributes: { name: t.track.track_name, artistName: t.track.artist_name, albumName: t.track.album_name, durationInMillis: t.track.track_length * 1000 },
                    originalTrack: t.track
                })));
                const bestMatch = SimilarityUtils.findBestSongMatch(candidates, title, artist, album, duration);
                if (bestMatch) return bestMatch.candidate.originalTrack;
            }
        }
        return null;
    }
    
    static async _fetchLyricsFromApi(trackId, userToken, requireWordSync) {
        try {
            const richLyrics = await this.getRichLyrics(trackId, userToken);
            if (richLyrics?.message?.body?.richsync) {
                return { lyrics: richLyrics, type: 'richsync' };
            }
        } catch (error) {
            console.warn('Failed to fetch richsync lyrics:', error);
        }

        if (!requireWordSync) {
            try {
                const subtitleLyrics = await this.getSubtitle(trackId, userToken);
                if (subtitleLyrics?.message?.body?.subtitle) {
                    return { lyrics: subtitleLyrics, type: 'subtitle' };
                }
            } catch (error) {
                console.warn('Failed to fetch subtitle lyrics:', error);
            }
        }
        
        return null;
    }
}