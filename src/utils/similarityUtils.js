// utils/similarityUtils.js
export class SimilarityUtils {
    // --- CORE NORMALIZATION & UTILITIES ---

    static normalizeString(str) {
        if (!str) return '';
        return str.toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Replace special chars with spaces
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Creates n-grams from a string. Used for Dice Coefficient.
     * @param {string} str The input string.
     * @param {number} size The size of the n-gram (e.g., 2 for bigrams).
     * @returns {Set<string>} A set of n-grams.
     */
    static getNGrams(str, size = 2) {
        if (!str || str.length < size) return new Set();
        const ngrams = new Set();
        for (let i = 0; i <= str.length - size; i++) {
            ngrams.add(str.substring(i, i + size));
        }
        return ngrams;
    }

    /**
     * Calculates the Sørensen-Dice coefficient between two strings, based on bigrams.
     * Excellent for finding similarity between phrases even with some different words.
     * @param {string} str1
     * @param {string} str2
     * @returns {number} Similarity score between 0 and 1.
     */
    static getDiceCoefficient(str1, str2) {
        const bigrams1 = this.getNGrams(str1, 2);
        const bigrams2 = this.getNGrams(str2, 2);

        if (bigrams1.size === 0 && bigrams2.size === 0) return 1.0;
        if (bigrams1.size === 0 || bigrams2.size === 0) return 0.0;

        const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
        return (2 * intersection.size) / (bigrams1.size + bigrams2.size);
    }

    static levenshteinDistance(str1, str2) {
        if (str1 === str2) return 0;
        if (!str1.length) return str2.length;
        if (!str2.length) return str1.length;

        if (str1.length > str2.length) {
            [str1, str2] = [str2, str1];
        }

        let prevRow = Array.from({ length: str1.length + 1 }, (_, i) => i);
        let currRow = Array.from({ length: str1.length + 1 }, () => 0);

        for (let j = 1; j <= str2.length; j++) {
            currRow[0] = j;
            for (let i = 1; i <= str1.length; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                currRow[i] = Math.min(
                    prevRow[i] + 1,        // Deletion
                    currRow[i - 1] + 1,    // Insertion
                    prevRow[i - 1] + cost  // Substitution
                );
            }
            [prevRow, currRow] = [currRow, prevRow];
        }

        return prevRow[str1.length];
    }

    // --- ADVANCED TITLE & ARTIST ANALYSIS ---

    /**
     * NEW: Analyzes a song title to separate the core title from descriptive tags.
     * Example: "Bohemian Rhapsody (Live at Wembley '86) - Remastered"
     * -> baseTitle: "bohemian rhapsody", tags: {'live', 'remastered'}
     * @param {string} title The raw song title.
     * @returns {{baseTitle: string, tags: Set<string>}}
     */
    static analyzeTitle(title) {
        const tags = new Set();
        const tagRegex = /(?:[-(]|\s-\s)(remix|live|acoustic|instrumental|radio\sedit|remastered|explicit|clean|unplugged|re-recorded|edit|version|mono|stereo|deluxe|anniversary|reprise|demo)(?:\W|$)/ig;

        let baseTitle = this.normalizeString(title);

        let match;
        while ((match = tagRegex.exec(baseTitle)) !== null) {
            tags.add(match[1].replace(/\s/g, '')); // Add tag like 'radioedit'
        }

        // Remove tags and surrounding brackets/hyphens for a clean base title
        baseTitle = baseTitle
            .replace(/\[[^\]]+\]/g, '') // Remove content in [square brackets]
            .replace(/\(\d+(?::\d+(?:\.\d+)?)?\)/g, '') // Remove duration patterns like (429) or (07:09.5)
            .replace(/\([^)]+\)/g, '')  // Remove other content in (parentheses)
            .replace(tagRegex, ' ')
            .replace(/\s-\s.*/, '') // Remove anything after " - "
            .replace(/\s+/g, ' ')
            .trim();

        return { baseTitle, tags };
    }

    /**
     * IMPROVED: Normalizes artist names by handling collaborations and sorting them.
     * This makes "Artist A & Artist B" equivalent to "Artist B & Artist A".
     * @param {string} artist The raw artist name.
     * @returns {string} A deeply normalized artist name.
     */
    static normalizeArtistName(artist) {
        if (!artist) return '';

        let normalized = artist.toLowerCase()
            .replace(/\[[^\]]+\]/g, '') // Remove [content]
            .replace(/\([^)]+\)/g, ''); // Remove (content)

        // Split artists by all common separators including 'feat.'
        const artists = normalized
            .split(/\s*(?:&|and|vs|feat\.?|ft\.?|featuring|with)\s*/)
            .map(name => name.replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim())
            .filter(Boolean); // Filter out any empty strings from multiple separators

        // Sort the individual artist names and join them.
        // "Artist B feat. Artist A" becomes "artist a artist b"
        // "Artist A & Artist B" also becomes "artist a artist b"
        return artists.sort().join(' ');
    }

    // --- COMPONENT SIMILARITY CALCULATIONS ---

    static calculateTitleSimilarity(title1, title2) {
        const analysis1 = this.analyzeTitle(title1);
        const analysis2 = this.analyzeTitle(title2);

        // Score 1: Similarity of the base titles
        const diceScore = this.getDiceCoefficient(analysis1.baseTitle, analysis2.baseTitle);
        const maxLength = Math.max(analysis1.baseTitle.length, analysis2.baseTitle.length);
        const levenshteinScore = maxLength > 0 ? 1 - (this.levenshteinDistance(analysis1.baseTitle, analysis2.baseTitle) / maxLength) : 1;

        // Combine Dice and Levenshtein for robust matching
        const baseTitleScore = (diceScore * 0.6) + (levenshteinScore * 0.4);

        // Score 2: Tag comparison
        let tagScore = 0;
        const allTags = new Set([...analysis1.tags, ...analysis2.tags]);
        if (allTags.size > 0) {
            const commonTags = new Set([...analysis1.tags].filter(t => analysis2.tags.has(t)));
            // Tags match: bonus
            if (commonTags.size === analysis1.tags.size && commonTags.size === analysis2.tags.size) {
                tagScore = 0.1; // Bonus for identical tags
            }
            // Tags mismatch: penalty
            else if (analysis1.tags.size > 0 && analysis2.tags.size > 0 && commonTags.size === 0) {
                tagScore = -0.25; // Heavy penalty for conflicting tags (e.g., live vs acoustic)
            }
        } else {
            tagScore = 0.05; // Small bonus if neither has tags
        }

        return Math.min(1.0, baseTitleScore + tagScore);
    }

    static calculateArtistSimilarity(artist1, artist2) {
        if (!artist1 || !artist2) return 0;

        const norm1 = this.normalizeArtistName(artist1);
        const norm2 = this.normalizeArtistName(artist2);

        if (norm1 === norm2) return 1.0;
        if (!norm1 || !norm2) return 0;

        // Use Dice Coefficient for normalized artist strings
        return this.getDiceCoefficient(norm1, norm2);
    }

    /**
     * IMPROVED: More sophisticated duration similarity calculation
     * Uses a combination of absolute difference and percentage difference
     * @param {number} duration1 Duration in seconds
     * @param {number} duration2 Duration in seconds
     * @returns {number} Similarity score between 0 and 1
     */
    static calculateDurationSimilarity(duration1, duration2) {
        // If either duration is missing, return neutral score
        if (duration1 === undefined || duration2 === undefined) return 0.5;

        // Convert to seconds if needed
        const dur1 = duration1 > 1000 ? duration1 / 1000 : duration1;
        const dur2 = duration2 > 1000 ? duration2 / 1000 : duration2;

        const diff = Math.abs(dur1 - dur2);
        const avgDuration = (dur1 + dur2) / 2;
        const percentageDiff = diff / avgDuration;

        // Perfect match
        if (diff === 0) return 1.0;

        // Very close (within 3 seconds or 2% difference)
        if (diff <= 3 || percentageDiff <= 0.02) return 0.98;

        // Close (within 5 seconds or 5% difference)
        if (diff <= 5 || percentageDiff <= 0.05) return 0.95;

        // Acceptable (within 10 seconds or 8% difference)
        if (diff <= 10 || percentageDiff <= 0.08) return 0.85;

        // Moderate difference (within 15 seconds or 12% difference)
        if (diff <= 15 || percentageDiff <= 0.12) return 0.7;

        // Large difference (within 30 seconds or 20% difference)
        if (diff <= 30 || percentageDiff <= 0.20) return 0.5;

        // Very large difference - exponential decay
        // Score approaches 0 as difference increases beyond 30 seconds
        const decayFactor = Math.exp(-diff / 60); // Decay over 1 minute
        return Math.max(0.1, 0.4 * decayFactor);
    }

    // --- MASTER SONG SIMILARITY ORCHESTRATOR ---

    /**
     * IMPROVED: Better handling of different data structures and enhanced duration matching
     */
    static calculateDurationSimilarity(duration1, duration2) {
        // If either duration is missing, return neutral score
        if (duration1 === undefined || duration2 === undefined) return 0.5;

        const dur1 = duration1;
        const dur2 = duration2;

        const diff = Math.abs(dur1 - dur2);
        const avgDuration = (dur1 + dur2) / 2;
        const percentageDiff = avgDuration > 0 ? diff / avgDuration : 0;

        // Perfect match
        if (diff === 0) return 1.0;

        // Very close (within 3 seconds or 2% difference)
        if (diff <= 3 || percentageDiff <= 0.02) return 0.98;

        // Close (within 5 seconds or 5% difference)
        if (diff <= 5 || percentageDiff <= 0.05) return 0.95;

        // Acceptable (within 10 seconds or 8% difference)
        if (diff <= 10 || percentageDiff <= 0.08) return 0.85;

        // Moderate difference (within 15 seconds or 12% difference)
        if (diff <= 15 || percentageDiff <= 0.12) return 0.7;

        // Large difference (within 30 seconds or 20% difference)
        if (diff <= 30 || percentageDiff <= 0.20) return 0.5;

        // Very large difference - exponential decay
        // Score approaches 0 as difference increases beyond 30 seconds
        const decayFactor = Math.exp(-diff / 60); // Decay over 1 minute
        return Math.max(0.1, 0.4 * decayFactor);
    }

    static calculateSongSimilarity(candidate, queryTitle, queryArtist, queryAlbum, queryDuration) {
        const attrs = candidate?.attributes || candidate;
        if (!attrs) return { score: 0 };

        const candTitle = attrs.name || attrs.title || '';
        const candArtist = attrs.artistName || attrs.artist || '';
        const candAlbum = attrs.albumName || attrs.album || '';

        let candDuration;
        if (attrs.durationInMillis) {
            candDuration = attrs.durationInMillis / 1000;
        } else if (attrs.durationMs) {
            candDuration = attrs.durationMs / 1000;
        } else if (attrs.duration) {
            candDuration = attrs.duration > 1000 ? attrs.duration / 1000 : attrs.duration;
        }

        const titleScore = this.calculateTitleSimilarity(candTitle, queryTitle);
        const artistScore = this.calculateArtistSimilarity(candArtist, queryArtist);

        const isDurationAvailable = queryDuration !== undefined && candDuration !== undefined;
        const isAlbumAvailable = queryAlbum && candAlbum;

        const albumScore = isAlbumAvailable ? this.getDiceCoefficient(this.normalizeString(candAlbum), this.normalizeString(queryAlbum)) : 0;
        const durationScore = this.calculateDurationSimilarity(candDuration, queryDuration);

        const getImportance = (score) => (Math.abs(score - 0.5) * 2) ** 2;

        const importances = {
            title: getImportance(titleScore),
            artist: getImportance(artistScore),
            album: isAlbumAvailable ? getImportance(albumScore) : 0,
            duration: isDurationAvailable ? getImportance(durationScore) : 0,
        };

        const totalImportance = Object.values(importances).reduce((sum, val) => sum + val, 0);

        if (totalImportance === 0) {
            return { score: 0.5, components: { titleScore, artistScore, albumScore, durationScore }, weights: { title: 0.25, artist: 0.25, album: 0.25, duration: 0.25 }, durations: { query: queryDuration, candidate: candDuration } };
        }

        const weights = {
            title: importances.title / totalImportance,
            artist: importances.artist / totalImportance,
            album: importances.album / totalImportance,
            duration: importances.duration / totalImportance,
        };

        const score = (titleScore * weights.title) +
            (artistScore * weights.artist) +
            (albumScore * weights.album) +
            (durationScore * weights.duration);

        return {
            score: Math.min(1.0, Math.max(0, score)),
            components: { titleScore, artistScore, albumScore, durationScore },
            weights,
            durations: { query: queryDuration, candidate: candDuration }
        };
    }

    // --- FINAL MATCHER ---

    static findBestSongMatch(candidates, queryTitle, queryArtist, queryAlbum, queryDuration) {
        if (!candidates?.length || !queryTitle) return null;

        // Handle both data structures
        const validCandidates = candidates.filter(c => {
            const attrs = c?.attributes || c;
            const title = attrs?.name || attrs?.title;
            const artist = attrs?.artistName || attrs?.artist;
            return title && artist;
        });

        if (validCandidates.length === 0) return null;

        const scoredCandidates = validCandidates.map(candidate => {
            const scoreInfo = this.calculateSongSimilarity(
                candidate, queryTitle, queryArtist || '', queryAlbum, queryDuration
            );
            return { candidate, scoreInfo };
        }).sort((a, b) => {
            // Primary sort: by total score
            if (Math.abs(a.scoreInfo.score - b.scoreInfo.score) > 0.01) {
                return b.scoreInfo.score - a.scoreInfo.score;
            }

            // Secondary sort: if scores are very close, prefer better duration match
            if (queryDuration !== undefined) {
                return b.scoreInfo.components.durationScore - a.scoreInfo.components.durationScore;
            }
            return b.scoreInfo.score - a.scoreInfo.score;
        });

        console.debug(`\n=== IMPROVED SONG MATCHING DEBUG ===`);
        console.debug(`Query: "${queryArtist}" - "${queryTitle}" (Duration: ${queryDuration}s)`);

        // --- FIX ---
        // The 'analysis' object is no longer returned from calculateSongSimilarity.
        // We generate the normalized query info directly here for debugging.
        const queryAnalysis = this.analyzeTitle(queryTitle);
        const normalizedQueryArtist = this.normalizeArtistName(queryArtist);
        console.debug(` -> Normalized Query: [Artist: ${normalizedQueryArtist}] [Title: ${queryAnalysis.baseTitle}] [Tags: ${[...queryAnalysis.tags].join(', ')}]`);

        console.debug(`\nTop 5 matches:`);

        scoredCandidates.slice(0, 5).forEach(({ candidate, scoreInfo }, index) => {
            const { score, components, durations } = scoreInfo;
            const attrs = candidate?.attributes || candidate;
            const durDiff = durations.query && durations.candidate ?
                Math.abs(durations.query - durations.candidate).toFixed(1) : 'N/A';

            console.debug(
                `${index + 1}. "${attrs.artistName || attrs.artist}" - "${attrs.name || attrs.title}" - "${attrs.albumName || attrs.album}"\n` +
                `   Score: ${score.toFixed(4)} | Duration: ${durations.candidate?.toFixed(1)}s (diff: ${durDiff}s)\n` +
                `   Components: T:${components.titleScore.toFixed(2)} A:${components.artistScore.toFixed(2)} Al:${components.albumScore.toFixed(2)} D:${components.durationScore.toFixed(2)}`
            );
        });

        const confidenceThreshold = 0.65;
        const bestMatch = scoredCandidates[0];

        if (bestMatch.scoreInfo.score < confidenceThreshold) {
            console.debug(`\n✗ NO CONFIDENT MATCH: Best score ${bestMatch.scoreInfo.score.toFixed(4)} is below threshold ${confidenceThreshold}`);
            console.debug(`=== END DEBUG ===\n`);
            return null;
        }

        if (scoredCandidates.length > 1) {
            const secondBestScore = scoredCandidates[1].scoreInfo.score;
            const scoreGap = bestMatch.scoreInfo.score - secondBestScore;

            if (scoreGap < 0.1 && bestMatch.scoreInfo.score < 0.8) {
                console.debug(`\n✗ AMBIGUOUS MATCH: Top score ${bestMatch.scoreInfo.score.toFixed(4)} is not significantly higher than next score ${secondBestScore.toFixed(4)}.`);
                console.debug(`=== END DEBUG ===\n`);
                return null;
            }
        }

        const attrs = bestMatch.candidate?.attributes || bestMatch.candidate;
        console.debug(`\n✓ SELECTED: "${attrs.artistName || attrs.artist}" - "${attrs.name || attrs.title}" (Score: ${bestMatch.scoreInfo.score.toFixed(4)})`);
        console.debug(`=== END DEBUG ===\n`);
        return bestMatch;
    }
}