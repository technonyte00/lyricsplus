// services/lyricsPlusService.js
import { FileUtils } from "../utils/fileUtils.js";
import { GDRIVE } from "../config.js";

export class LyricsPlusService {
    static async fetchLyrics(songTitle, songArtist, songAlbum, songDuration, gd) {
        try {
            const userJsonFile = await FileUtils.findUserJSON(gd, songTitle, songArtist, songAlbum, songDuration);
            if (userJsonFile) {
                const jsonContent = await gd.fetchFile(userJsonFile.id);
                if (jsonContent) {
                    const parsedJson = JSON.parse(jsonContent);
                    if (FileUtils.hasSyllableSync(parsedJson) || FileUtils.hasLineSync(parsedJson)) {
                        parsedJson.metadata = parsedJson.metadata || {};
                        parsedJson.metadata.source = 'Lyrics+';
                        parsedJson.cached = 'UserJSON';
                        return { success: true, data: parsedJson, source: 'lyricsplus' };
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to check user JSON:', error);
        }
        return null;
    }

    /**
     * Upload or update timeline lyrics to Google Drive.
     *
     * @param {object} gd - Google Drive handler.
     * @param {string} songTitle - Title of the song.
     * @param {string} songArtist - Artist name.
     * @param {string} songAlbum - Album name.
     * @param {number} songDuration - Duration of the song.
     * @param {object} lyricsData - Lyrics data containing at least a "lyrics" property.
     * @param {boolean} forceUpload - Flag to force update if file exists.
     *
     * @returns {object} Result object with success flag and error message if any.
     */
    static async uploadTimelineLyrics(gd, songTitle, songArtist, songAlbum, songDuration, lyricsData, forceUpload = false) {
        try {
            // Check if type and metadata exists
            if (!lyricsData.type || !lyricsData.metadata || !lyricsData.lyrics) {
                return { success: false, error: "Missing required fields: type or lyrics" };
            }

            // Generate unique file name based on song metadata.
            const fileName = await FileUtils.generateUniqueFileName(songTitle, songArtist, songAlbum, songDuration);
            const fullFileName = `${fileName}.json`;
            
            // Find existing file in the designated folder (GDRIVE.USERTML_JSON)
            const existingUGCFile = await FileUtils.findExistingFile(
                gd,
                songTitle,
                songArtist,
                songAlbum,
                songDuration,
                GDRIVE.USERTML_JSON,
                'application/json'
            );

            // Check if the found file has exactly the same name
            const isExactMatch = existingUGCFile && existingUGCFile.name === fullFileName;

            if (existingUGCFile && isExactMatch && forceUpload) {
                // Fetch previous file content for verification.
                const previousContent = await gd.fetchFile(existingUGCFile.id);
                if (previousContent) {
                    const previousData = JSON.parse(previousContent);
                    // Verify if the update might be vandalism.
                    if (this.isVandalismUpdate(previousData, lyricsData)) {
                        console.warn("Vandalism detected in the update. Update aborted.");
                        return { success: false, error: "Vandalism detected. Update aborted." };
                    }
                }
                // Update the existing file.
                await gd.updateFile(existingUGCFile.id, JSON.stringify(lyricsData));
                console.debug(`Updated existing file: ${fullFileName}`);
            } else if (!existingUGCFile || !isExactMatch) {
                // Upload a new file if no existing file is found or if names don't match exactly
                await gd.uploadFile(
                    fullFileName,
                    'application/json',
                    JSON.stringify(lyricsData),
                    GDRIVE.USERTML_JSON
                );
                console.debug(`Uploaded new file: ${fullFileName}`);
            } else {
                // File exists but forceUpload is false.
                console.debug("File already exists and forceUpload is false. No upload performed.");
                return { success: false, error: "File exists. Set forceUpload to true to update." };
            }
            return { success: true };
        } catch (error) {
            console.error("Error uploading timeline lyrics:", error);
            return { success: false, error };
        }
    }

    /**
     * Check if the lyrics update might be vandalism.
     * This simple check flags an update as vandalism if the new lyrics are less than 50% the length of the previous lyrics.
     *
     * @param {object} previousData - Previously stored lyrics data.
     * @param {object} newData - New lyrics data to update.
     *
     * @returns {boolean} True if update is suspected as vandalism.
     */
    static isVandalismUpdate(previousData, newData) {
        // Ensure both data objects have a 'lyrics' property.
        //if (!previousData.lyrics || !newData.lyrics) return false;
        //const previousLyrics = previousData.lyrics;
        //const newLyrics = newData.lyrics;
        
        // Flag as vandalism if new lyrics are less than 50% of previous lyrics length.
        //return newLyrics.length < previousLyrics.length * 0.5;
        return false;
    }
}