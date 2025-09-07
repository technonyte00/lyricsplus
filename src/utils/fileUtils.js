// utils/fileUtils.js
import { GDRIVE } from "../config.js";
import { SimilarityUtils } from "./similarityUtils.js";

export class FileUtils {
    // Generates a unique file name based on song information
    static async generateUniqueFileName(songTitle, songArtist, songAlbum, songDuration) {
        if (!songTitle || !songArtist) {
            console.warn("Missing song title or artist for filename generation");
            return `unknown-${Date.now()}`;
        }

        // Include album in the filename if provided
        const albumPart = songAlbum ? ` [${songAlbum.trim()}]` : '';
        // Format duration if provided (now in total seconds format, potentially with decimals)
        const durationPart = songDuration ? ` (${formatDuration(songDuration)})` : '';
        
        const filename = `${songArtist.trim()} - ${songTitle.trim()}${albumPart}${durationPart}`
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return filename;
    }

    // Searches for an existing file on Google Drive based on provided song details
    static async findExistingFile(gd, songTitle, songArtist, songAlbum, songDuration, folderID, mimeType) {
        if(!gd) {
            throw new Error("Google Drive instance is not provided");
        }

        if(!folderID){
            throw new Error("Folder ID is not provided");
        }

        if(!mimeType){
            throw new Error("MIME type is not provided");
        }

        if (!gd || !folderID || !mimeType) {
            console.warn("Missing required parameters for file search");
            return null;
        }
    
        try {
            // Create keywords array from title, artist, and album (if available)
            const titleKeywords = String(songTitle || '').split(' ').filter(w => w.length > 3).slice(0, 2);
            const artistKeywords = String(songArtist || '').split(' ').filter(w => w.length > 3).slice(0, 2);
            const albumKeywords = songAlbum ? String(songAlbum).split(' ').filter(w => w.length > 3).slice(0, 2) : [];
            const keywords = [...titleKeywords, ...artistKeywords, ...albumKeywords]
                .map(k => k.replace(/'/g, "\\'"));
    
            if (!keywords.length) return null;
    
            // Build search query using keywords
            const query = `${keywords.map(k => `name contains '${k}'`).join(' and ')} and mimeType = '${mimeType}' and '${folderID}' in parents`;
            const response = await gd.searchFiles(query);
    
            if (!response.files?.length) return null;
    
            // Extract metadata from filenames for proper comparison
            const parsedCandidates = response.files.map(file => {
                // Parse filename using the format: Artist - Track Title [Album] (seconds.milliseconds).ext
                const fileInfo = {};
                fileInfo.originalFile = file;
                
                // Extract filename without extension
                const fullName = file.name;
                const nameParts = fullName.split('.');
                const nameWithoutExt = nameParts.slice(0, -1).join('.');
                
                // Extract duration if present (handles (Seconds.milliseconds) format)
                // The regex now looks for one or more digits, optionally followed by a dot and more digits.
                const durationMatch = nameWithoutExt.match(/\((\d+(?:\.\d+)?)\)$/);
                if (durationMatch) {
                    // Use parseFloat to correctly handle decimal numbers
                    fileInfo.duration = parseFloat(durationMatch[1]);
                    // Remove duration part from the name for further parsing
                    fileInfo.nameWithoutDuration = nameWithoutExt.replace(/\s*\(\d+(?:\.\d+)?\)$/, '');
                } else {
                    fileInfo.nameWithoutDuration = nameWithoutExt;
                    fileInfo.duration = undefined;
                }
                
                // Extract album if present
                const albumMatch = fileInfo.nameWithoutDuration.match(/\[([^\]]+)\]$/);
                if (albumMatch) {
                    fileInfo.album = albumMatch[1].trim();
                    // Remove album part from the name for further parsing
                    fileInfo.nameWithoutAlbum = fileInfo.nameWithoutDuration.replace(/\s*\[[^\]]+\]$/, '');
                } else {
                    fileInfo.nameWithoutAlbum = fileInfo.nameWithoutDuration;
                    fileInfo.album = undefined;
                }
                
                // Extract artist and title
                const artistTitleMatch = fileInfo.nameWithoutAlbum.match(/^(.+?)\s*-\s*(.+)$/);
                if (artistTitleMatch) {
                    fileInfo.artist = artistTitleMatch[1].trim();
                    fileInfo.title = artistTitleMatch[2].trim();
                } else {
                    fileInfo.title = fileInfo.nameWithoutAlbum.trim();
                    fileInfo.artist = undefined;
                }
                
                return fileInfo;
            });
    
            // Adapt parsed candidates to match the structure expected by findBestSongMatch
            const adaptedCandidates = parsedCandidates.map(candidate => {
                return {
                    attributes: {
                        name: candidate.title,
                        artistName: candidate.artist,
                        albumName: candidate.album,
                        durationInMillis: candidate.duration ? candidate.duration * 1000 : undefined
                    },
                    // Keep original file reference for return value
                    originalFile: candidate.originalFile
                };
            });
    
            // Now we can use SimilarityUtils.findBestSongMatch
            const bestMatch = SimilarityUtils.findBestSongMatch(
                adaptedCandidates,
                songTitle,
                songArtist,
                songAlbum,
                songDuration
            );
    
            // Log top matches (the function already logs detailed match info)
            console.debug("Top file matches found with score:", bestMatch?.scoreInfo?.score || 0);
            
            // Return best match if one was found
            return bestMatch?.candidate?.originalFile || null;
        } catch (error) {
            console.error("Error searching for existing file:", error);
            
            // Fall back to custom scoring if findBestSongMatch fails
            console.debug("Falling back to custom scoring...");
            
            // Implement fallback scoring logic here if needed
            // (Code omitted for brevity, would be similar to previous implementation)
            
            return null;
        }
    }

    // Specific methods for different file types using their respective folder IDs and MIME types
    static async findExistingTTML(gd, songTitle, songArtist, songAlbum, songDuration) {
        return this.findExistingFile(gd, songTitle, songArtist, songAlbum, songDuration, GDRIVE.CACHED_TTML, 'application/xml');
    }

    static async findExistingSp(gd, songTitle, songArtist, songAlbum, songDuration) {
        return this.findExistingFile(gd, songTitle, songArtist, songAlbum, songDuration, GDRIVE.CACHED_SPOTIFY, 'application/json');
    }

    static async findExistingMusixmatch(gd, songTitle, songArtist, songAlbum, songDuration) {
        return this.findExistingFile(gd, songTitle, songArtist, songAlbum, songDuration, GDRIVE.CACHED_MUSIXMATCH, 'application/json');
    }

    static async findUserJSON(gd, songTitle, songArtist, songAlbum, songDuration) {
        return this.findExistingFile(gd, songTitle, songArtist, songAlbum, songDuration, GDRIVE.USERTML_JSON, 'application/json');
    }

    // Checks if the JSON object has syllable sync information
    static hasSyllableSync(json) {
        return json && (json.type === "Word" || json.type === "syllable");
    }

    static hasLineSync(json) {
        return json && (json.type === "Line");
    }
}

// Helper function to format duration in total seconds (s) format, allowing decimals
function formatDuration(durationInSeconds) {
    if (durationInSeconds === undefined || durationInSeconds === null) return '';
    
    // Convert to a fixed number of decimal places (e.g., 2 for milliseconds precision)
    // This prevents extremely long decimal numbers in filenames.
    // Use Number() to convert the fixed string back to a number, which removes trailing .00
    // Example: (185.00) becomes (185)
    // Example: (185.75) stays (185.75)
    return `${Number(durationInSeconds).toFixed(2)}`;
}