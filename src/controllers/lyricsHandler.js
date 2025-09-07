
import { AppleMusicService } from "../services/appleMusicService.js";
import { MusixmatchService } from "../services/musixmatchService.js";
import { SpotifyService } from "../services/spotifyService.js";
import { LyricsPlusService } from "../services/lyricsPlusService.js";
import { FileUtils } from "../utils/fileUtils.js";
import { GDRIVE } from "../config.js";
import GoogleDrive from "../utils/googleDrive.js";

const gd = new GoogleDrive();
var cachedSongs;

export async function fetchSongs() {
  if (!cachedSongs) {
    const fileContent = await gd.fetchFile(GDRIVE.SONGS_FILE_ID);
    if (typeof fileContent === "string" && (fileContent.trim().startsWith("{") || fileContent.trim().startsWith("["))) {
      cachedSongs = JSON.parse(fileContent || "[]");
    } else {
      cachedSongs = fileContent || [];
    }
    console.debug('Downloading... songList');
  }

  return cachedSongs;
}

export async function safeFetchSongs() {
    try {
        return await fetchSongs();
    } catch (error) {
        console.warn("fetchSongs() failed, attempting to reload from cache:", error);
        return [];
    }
}

/**
 * Saves the best lyrics to Google Drive.
 * @param {string} source - The source of the lyrics (e.g., 'apple', 'musixmatch', 'spotify').
 * @param {string} fileName - The base file name for the lyrics.
 * @param {object|string} rawData - The raw data fetched from the source (e.g., TTML, Spotify JSON, Musixmatch JSON).
 * @param {object} convertedData - The converted lyrics data in LyricsPlus format.
 * @param {object} existingFile - Information about an existing file in Google Drive, if found.
 * @param {object} gd - Google Drive handler.
 * @param {object} songTitle - Song title
 * @param {object} songArtist - Song artist
 * @param {object} songAlbum - Song album
 * @param {object} songDuration - Song duration
 * @param {object} songs - Cached songs list
 */
async function saveBestLyrics(source, fileName, rawData, convertedData, existingFile, gd, songTitle, songArtist, songAlbum, songDuration, songs) {
    let fileId;
    try {
        if (source === 'apple') {
            if (existingFile) {
                fileId = await gd.updateFile(existingFile.id, rawData);
            } else {
                fileId = await gd.uploadFile(
                    `${fileName}.ttml`,
                    'application/xml',
                    rawData,
                    GDRIVE.CACHED_TTML
                );
            }
            // Update song database for Apple Music
            const newSong = {
                id: convertedData.metadata.appleMusicId, 
                artist: songArtist,
                track_name: songTitle,
                album: songAlbum,
                ttmlFileId: fileId,
                source: 'Apple',
            };

            const songIndex = songs.findIndex(
                s => s && s.track_name?.toLowerCase() === songTitle?.toLowerCase() &&
                    s.artist?.toLowerCase() === songArtist?.toLowerCase() &&
                    (!songAlbum || s.album?.toLowerCase() === songAlbum?.toLowerCase())
            );

            if (songIndex !== -1) {
                songs[songIndex] = newSong;
            } else {
                songs.push(newSong);
            }
            await AppleMusicService.saveSongs(songs); 
        } else if (source === 'musixmatch') {
            if (existingFile) {
                fileId = await gd.updateFile(existingFile.id, JSON.stringify(rawData));
            } else {
                fileId = await gd.uploadFile(
                    `${fileName}.json`,
                    'application/json',
                    JSON.stringify(rawData),
                    GDRIVE.CACHED_MUSIXMATCH
                );
            }
        } else if (source === 'spotify') {
            if (existingFile) {
                fileId = await gd.updateFile(existingFile.id, JSON.stringify(rawData));
            } else {
                fileId = await gd.uploadFile(
                    `${fileName}.json`,
                    'application/json',
                    JSON.stringify(rawData),
                    GDRIVE.CACHED_SPOTIFY
                );
            }
        }
        console.debug(`Successfully saved best lyrics from ${source} to Google Drive.`);
    } catch (error) {
        console.error(`Failed to save lyrics from ${source}:`, error);
    }
}

export async function handleSongLyrics(
    songTitle = "",
    songArtist = "",
    songAlbum = "",
    songDuration = "",
    songs,
    gd,
    preferredSources = [],
    forceReload = false,
    env
) {
    // Initial filename generation using original search query for logging
    const initialFileName = await FileUtils.generateUniqueFileName(songTitle, songArtist, songAlbum, songDuration);
    console.debug('Looking for:', initialFileName, forceReload ? '(Force reload enabled)' : '');

    const sources = preferredSources.length > 0 ? preferredSources : ['apple', 'lyricsplus', 'musixmatch-word', 'musixmatch', 'spotify'];
    
    const promises = [];
    sources.forEach(source => {
        let promise;
        switch (source) {
            case 'apple':
                console.debug('Queueing AppleMusic Fetch');
                promise = AppleMusicService.fetchLyrics(songTitle, songArtist, songAlbum, songDuration, songs, gd, forceReload, sources);
                break;
            case 'lyricsplus':
                console.debug('Queueing LyricsPlus Fetch');
                promise = LyricsPlusService.fetchLyrics(songTitle, songArtist, songAlbum, songDuration, gd);
                break;
            case 'musixmatch-word':
                console.debug('Queueing MusixMatch (Word Sync) Fetch');
                promise = MusixmatchService.fetchLyrics(songTitle, songArtist, songAlbum, songDuration, gd, forceReload, env, true);
                break;
            case 'musixmatch':
                console.debug('Queueing MusixMatch (Line/Any Sync) Fetch');
                promise = MusixmatchService.fetchLyrics(songTitle, songArtist, songAlbum, songDuration, gd, forceReload, env, false);
                break;
            case 'spotify':
                console.debug('Queueing Spotify (as MusixMatch alt) Fetch');
                promise = SpotifyService.fetchLyrics(songTitle, songArtist, songAlbum, songDuration, gd, forceReload);
                break;
        }
        if (promise) {
            promises.push(promise.catch(e => {
                console.error(`Error fetching from ${source}:`, e);
                return null; // Ensure promise always resolves
            }));
        }
    });

    const results = await Promise.all(promises);
    const successfulResults = results.filter(r => r && r.success && r.data && r.data.lyrics && r.data.lyrics.length > 0);

    if (successfulResults.length > 0) {
        const getSyncPriority = (result) => {
            if (!result || !result.data) return 0;

            const sourceType = result.source ? result.source.toLowerCase() : '';
            const data = result.data;

            if (sourceType.includes('musixmatch') || sourceType.includes('spotify')) {
                const syncType = data.type ? data.type.toUpperCase() : '';
                if (syncType === 'WORD' || syncType === 'SYLLABLE') return 3; // Best quality
                if (syncType === 'LINE') return 2; // Good quality
                return 1; // Basic quality
            }

            // For Apple Music and LyricsPlus, we check for syllable-level sync
            if (sourceType.includes('apple') || sourceType.includes('lyricsplus')) {
                // hasSyllableSync returns true for word-level sync
                return FileUtils.hasSyllableSync(data) ? 3 : 2;
            }

        };

        const bestResult = successfulResults.reduce((best, current) => {
            const bestPriority = getSyncPriority(best);
            const currentPriority = getSyncPriority(current);
            return currentPriority > bestPriority ? current : best;
        });

        const exactSongTitle = bestResult.exactMetadata?.title || bestResult.data.metadata.title || songTitle;
        const exactSongArtist = bestResult.exactMetadata?.artist || bestResult.data.metadata.artist || songArtist;
        const exactSongAlbum = bestResult.exactMetadata?.album || bestResult.data.metadata.album || songAlbum;
        const exactSongDuration = bestResult.exactMetadata?.durationMs ? bestResult.exactMetadata.durationMs / 1000 : (bestResult.data.metadata.durationMs ? bestResult.data.metadata.durationMs / 1000 : songDuration);

        const finalFileName = await FileUtils.generateUniqueFileName(exactSongTitle, exactSongArtist, exactSongAlbum, exactSongDuration);

        if (bestResult.rawData && bestResult.data.cached !== 'GDrive' && bestResult.data.cached !== 'Database') {
            await saveBestLyrics(
                bestResult.source.toLowerCase().replace('-word', ''), //normalize musixmatch
                finalFileName, 
                bestResult.rawData,
                bestResult.data,
                bestResult.existingFile,
                gd,
                exactSongTitle, 
                exactSongArtist,
                exactSongAlbum,
                exactSongDuration,
                songs
            );
        }

        return bestResult;
    }

    return {
        success: false,
        status: 404,
        data: {
            message: `Lyrics not found in sources: ${sources.join(', ')}`,
            status: 404,
            details: {
                searchedSources: sources,
                songInfo: {
                    title: songTitle,
                    artist: songArtist, 
                    album: songAlbum
                }
            }
        }
    };
}
