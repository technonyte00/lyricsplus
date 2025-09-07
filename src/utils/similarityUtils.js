// utils/similarityUtils.js
export class SimilarityUtils {

    static normalizeString(str) {
        if (!str) return '';
        return str.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Creates n-grams from a string for similarity comparison
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
     * Calculates Dice coefficient between two strings
     */
    static getDiceCoefficient(str1, str2) {
        if (!str1 && !str2) return 1.0;
        if (!str1 || !str2) return 0.0;

        const bigrams1 = this.getNGrams(str1, 2);
        const bigrams2 = this.getNGrams(str2, 2);

        if (bigrams1.size === 0 && bigrams2.size === 0) return 1.0;
        if (bigrams1.size === 0 || bigrams2.size === 0) return 0.0;

        const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
        return (2 * intersection.size) / (bigrams1.size + bigrams2.size);
    }

    /**
     * Optimized Levenshtein distance calculation
     */
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
                    prevRow[i] + 1,
                    currRow[i - 1] + 1,
                    prevRow[i - 1] + cost
                );
            }
            [prevRow, currRow] = [currRow, prevRow];
        }

        return prevRow[str1.length];
    }


    /**
     * Enhanced title analysis that properly handles featuring artists and various tags
     */
    static analyzeTitle(title) {
        if (!title) return { baseTitle: '', tags: new Set(), featArtists: [] };

        const tags = new Set();
        const featArtists = [];
        let cleanTitle = this.normalizeString(title);

        // Extract featuring artists from title first (before removing other content)
        const featRegex = /(?:\s+(?:feat\.?|ft\.?|featuring|with)\s+([^()[\]]+))(?=\s*[()[\]]|$)/gi;
        let featMatch;
        while ((featMatch = featRegex.exec(cleanTitle)) !== null) {
            const artists = featMatch[1].split(/\s*[&,]\s*/).map(a => a.trim()).filter(Boolean);
            featArtists.push(...artists);
        }

        // Remove featuring artists from title
        cleanTitle = cleanTitle.replace(featRegex, ' ');

        // Extract version tags
        const tagPatterns = [
            /(?:[-(]|\s-\s)(remix|mix|rmx)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(live|concert)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(acoustic|unplugged)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(instrumental|karaoke)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(radio\s?edit|single\s?edit)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(remaster(?:ed)?|rerecorded?)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(explicit|clean|censored)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(demo|rough|rough\s?mix)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(extended|ext|full)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(deluxe|anniversary|special)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(mono|stereo)(?:\W|$)/gi,
            /(?:[-(]|\s-\s)(edit|version|ver\.?)(?:\W|$)/gi
        ];

        tagPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(cleanTitle)) !== null) {
                tags.add(match[1].toLowerCase().replace(/\s+/g, ''));
            }
        });

        // Remove brackets and parentheses content
        cleanTitle = cleanTitle
            .replace(/\[[^\]]*\]/g, ' ')  // Remove [content]
            .replace(/\([^)]*\)/g, ' ')   // Remove (content)
            .replace(/\{[^}]*\}/g, ' ')   // Remove {content}
            .replace(/\s-\s.*$/, ' ')     // Remove everything after " - "
            .replace(/\s+/g, ' ')
            .trim();

        // Remove common prefixes/suffixes
        cleanTitle = cleanTitle
            .replace(/^(?:the\s+|a\s+|an\s+)/i, '')
            .replace(/\s+(?:the|a|an)$/i, '');

        return {
            baseTitle: cleanTitle,
            tags,
            featArtists
        };
    }

    /**
     * Enhanced artist normalization that handles all collaboration formats
     */
    static normalizeArtistName(artist) {
        if (!artist) return '';

        let normalized = artist.toLowerCase()
            .replace(/\[[^\]]*\]/g, '')  // Remove [content]
            .replace(/\([^)]*\)/g, '');  // Remove (content)

        // Extract all artist names from various separator formats
        const separatorRegex = /\s*(?:&|and|vs\.?|versus|x|feat\.?|ft\.?|featuring|with|,)\s*/gi;
        const artists = normalized
            .split(separatorRegex)
            .map(name => {
                return name
                    .replace(/\bthe\b/g, '')  // Remove "the"
                    .replace(/\s+/g, ' ')
                    .trim();
            })
            .filter(Boolean)
            .filter(name => name.length > 0);

        // Sort artist names for consistent comparison
        return artists.sort().join(' ');
    }


    /**
     * Enhanced title similarity with exact match bonus and featuring artist handling
     */
    static calculateTitleSimilarity(title1, title2) {
        if (!title1 || !title2) return 0;

        const analysis1 = this.analyzeTitle(title1);
        const analysis2 = this.analyzeTitle(title2);

        // Exact match check (highest priority)
        if (analysis1.baseTitle === analysis2.baseTitle && analysis1.baseTitle.length > 0) {
            // Check if tags conflict
            const conflictingTags = [...analysis1.tags].some(tag =>
                analysis2.tags.size > 0 && !analysis2.tags.has(tag) &&
                ['live', 'acoustic', 'remix', 'instrumental'].includes(tag)
            );

            if (conflictingTags) {
                return 0.85; // High but not perfect due to version difference
            }

            return 1.0; // Perfect match
        }

        // Calculate base similarity
        const diceScore = this.getDiceCoefficient(analysis1.baseTitle, analysis2.baseTitle);
        const maxLength = Math.max(analysis1.baseTitle.length, analysis2.baseTitle.length);
        const levenshteinScore = maxLength > 0 ?
            1 - (this.levenshteinDistance(analysis1.baseTitle, analysis2.baseTitle) / maxLength) : 0;

        // Weighted combination favoring Dice for phrase similarity
        let baseSimilarity = (diceScore * 0.7) + (levenshteinScore * 0.3);

        // Tag analysis
        let tagPenalty = 0;
        const criticalTags = ['live', 'acoustic', 'remix', 'instrumental', 'karaoke'];

        // Heavy penalty for conflicting critical tags
        const tags1Critical = [...analysis1.tags].filter(t => criticalTags.includes(t));
        const tags2Critical = [...analysis2.tags].filter(t => criticalTags.includes(t));

        if (tags1Critical.length > 0 && tags2Critical.length > 0) {
            const hasConflict = !tags1Critical.some(t => tags2Critical.includes(t));
            if (hasConflict) {
                tagPenalty = 0.4; // Major penalty for conflicting versions
            }
        } else if (tags1Critical.length > 0 || tags2Critical.length > 0) {
            tagPenalty = 0.15; // Moderate penalty if only one has critical tags
        }

        return Math.max(0, baseSimilarity - tagPenalty);
    }

    /**
     * Enhanced artist similarity with featuring artist handling
     */
    static calculateArtistSimilarity(artist1, artist2, title1Analysis = null, title2Analysis = null) {
        if (!artist1 || !artist2) return 0;

        const norm1 = this.normalizeArtistName(artist1);
        const norm2 = this.normalizeArtistName(artist2);

        // Exact match
        if (norm1 === norm2) return 1.0;

        // Create comprehensive artist lists including featuring artists from titles
        const allArtists1 = new Set([norm1]);
        const allArtists2 = new Set([norm2]);

        if (title1Analysis?.featArtists) {
            title1Analysis.featArtists.forEach(feat => {
                allArtists1.add(this.normalizeArtistName(feat));
            });
        }

        if (title2Analysis?.featArtists) {
            title2Analysis.featArtists.forEach(feat => {
                allArtists2.add(this.normalizeArtistName(feat));
            });
        }

        // Check for any artist overlap
        const hasOverlap = [...allArtists1].some(a1 => [...allArtists2].some(a2 => a1 === a2));
        if (hasOverlap) return 0.9; // High similarity for artist overlap

        // Fallback to string similarity
        return this.getDiceCoefficient(norm1, norm2);
    }

    /**
     * Strict duration matching within ±2 seconds
     */
    static calculateDurationSimilarity(duration1, duration2) {
        // If either duration is missing, return neutral score
        if (duration1 === undefined || duration2 === undefined ||
            duration1 === null || duration2 === null) {
            return 0.7; // Higher neutral score when duration missing
        }

        const diff = Math.abs(duration1 - duration2);

        // Perfect match
        if (diff === 0) return 1.0;

        // Within ±2 seconds (strict requirement)
        if (diff <= 2.0) return 0.95;

        // Beyond 2 seconds - exponential decay
        if (diff <= 5) return 0.7;
        if (diff <= 10) return 0.4;
        if (diff <= 15) return 0.2;

        return 0.05; // Very low score for large differences
    }

    /**
     * Enhanced album similarity
     */
    static calculateAlbumSimilarity(album1, album2) {
        if (!album1 || !album2) return 0.1; // Low neutral score

        const norm1 = this.normalizeString(album1);
        const norm2 = this.normalizeString(album2);

        if (norm1 === norm2) return 1.0;

        // Use Dice coefficient for album names
        return this.getDiceCoefficient(norm1, norm2);
    }


    /**
     * Completely rewritten song similarity calculation with better weighting
     */
    static calculateSongSimilarity(candidate, queryTitle, queryArtist, queryAlbum, queryDuration) {
        const attrs = candidate?.attributes || candidate;
        if (!attrs) return { score: 0, reason: 'Invalid candidate' };

        // Extract candidate data
        const candTitle = attrs.name || attrs.title || '';
        const candArtist = attrs.artistName || attrs.artist || '';
        const candAlbum = attrs.albumName || attrs.album || '';

        if (!candTitle || !candArtist) {
            return { score: 0, reason: 'Missing title or artist' };
        }

        // Parse duration
        let candDuration;
        if (attrs.durationInMillis) {
            candDuration = attrs.durationInMillis / 1000;
        } else if (attrs.durationMs) {
            candDuration = attrs.durationMs / 1000;
        } else if (attrs.duration) {
            candDuration = attrs.duration > 1000 ? attrs.duration / 1000 : attrs.duration;
        }

        // Analyze titles for featuring artists
        const queryTitleAnalysis = this.analyzeTitle(queryTitle);
        const candTitleAnalysis = this.analyzeTitle(candTitle);

        // Calculate component similarities
        const titleScore = this.calculateTitleSimilarity(candTitle, queryTitle);
        const artistScore = this.calculateArtistSimilarity(
            candArtist, queryArtist || '', candTitleAnalysis, queryTitleAnalysis
        );
        const albumScore = this.calculateAlbumSimilarity(candAlbum, queryAlbum);
        const durationScore = this.calculateDurationSimilarity(candDuration, queryDuration);

        // Enhanced scoring logic
        let finalScore = 0;
        let reason = '';

        // Critical thresholds
        const titleThreshold = 0.7;
        const artistThreshold = 0.6;
        const durationThreshold = 0.3;

        // Title and artist are mandatory for a good match
        if (titleScore < titleThreshold) {
            return {
                score: Math.min(0.4, titleScore * 0.5),
                reason: `Title similarity too low: ${titleScore.toFixed(3)}`,
                components: { titleScore, artistScore, albumScore, durationScore },
                durations: { query: queryDuration, candidate: candDuration }
            };
        }

        if (artistScore < artistThreshold) {
            return {
                score: Math.min(0.5, artistScore * 0.7),
                reason: `Artist similarity too low: ${artistScore.toFixed(3)}`,
                components: { titleScore, artistScore, albumScore, durationScore },
                durations: { query: queryDuration, candidate: candDuration }
            };
        }

        // Duration check (strict ±2 second requirement when available)
        // Only apply strict check if both queryDuration and candDuration are meaningful (positive) numbers
        if (queryDuration > 0 && candDuration > 0) {
            if (Math.abs(queryDuration - candDuration) > 2.0) {
                return {
                    score: Math.min(0.6, (titleScore + artistScore) / 2 * 0.8),
                    reason: `Duration difference too large: ${Math.abs(queryDuration - candDuration).toFixed(1)}s`,
                    components: { titleScore, artistScore, albumScore, durationScore },
                    durations: { query: queryDuration, candidate: candDuration }
                };
            }
        }

        // Dynamic weighting based on data availability
        let weights = { title: 0.5, artist: 0.4, album: 0.05, duration: 0.05 };

        if (queryDuration !== undefined && queryDuration !== null &&
            candDuration !== undefined && candDuration !== null) {
            weights = { title: 0.35, artist: 0.35, album: 0.1, duration: 0.2 };
        }

        if (queryAlbum && candAlbum) {
            if (queryDuration !== undefined && queryDuration !== null &&
                candDuration !== undefined && candDuration !== null) {
                weights = { title: 0.3, artist: 0.3, album: 0.2, duration: 0.2 };
            } else {
                weights = { title: 0.4, artist: 0.4, album: 0.2, duration: 0 };
            }
        }

        // Calculate weighted score
        finalScore = (titleScore * weights.title) +
            (artistScore * weights.artist) +
            (albumScore * weights.album) +
            (durationScore * weights.duration);

        // Bonus for exact matches
        if (titleScore === 1.0 && artistScore >= 0.9) {
            finalScore = Math.min(1.0, finalScore + 0.05);
            reason = 'Exact title and artist match';
        }

        return {
            score: Math.min(1.0, Math.max(0, finalScore)),
            reason: reason || 'Good match',
            components: { titleScore, artistScore, albumScore, durationScore },
            weights,
            durations: { query: queryDuration, candidate: candDuration }
        };
    }

    /**
     * Completely rewritten song matching with better logic and debugging
     */
    static findBestSongMatch(candidates, queryTitle, queryArtist, queryAlbum, queryDuration) {
        if (!candidates?.length || !queryTitle) {
            console.debug('❌ No candidates or query title provided');
            return null;
        }

        // Filter valid candidates
        const validCandidates = candidates.filter(c => {
            const attrs = c?.attributes || c;
            const title = attrs?.name || attrs?.title;
            const artist = attrs?.artistName || attrs?.artist;
            return title && artist;
        });

        if (validCandidates.length === 0) {
            console.debug('❌ No valid candidates found');
            return null;
        }

        console.debug(`\n🎵 SONG MATCHING - Enhanced Algorithm`);
        console.debug(`Query: "${queryArtist || 'Unknown'}" - "${queryTitle}"`);
        console.debug(`Album: "${queryAlbum || 'N/A'}" | Duration: ${queryDuration || 'N/A'}s`);
        console.debug(`Candidates: ${validCandidates.length}`);

        // Score all candidates
        const scoredCandidates = validCandidates.map(candidate => {
            const scoreInfo = this.calculateSongSimilarity(
                candidate, queryTitle, queryArtist, queryAlbum, queryDuration
            );
            return { candidate, scoreInfo };
        });

        // Sort by score (primary) and then by duration accuracy (secondary)
        scoredCandidates.sort((a, b) => {
            if (Math.abs(a.scoreInfo.score - b.scoreInfo.score) > 0.001) {
                return b.scoreInfo.score - a.scoreInfo.score;
            }
            // If scores are very close, prefer better duration match
            if (queryDuration !== undefined) {
                return b.scoreInfo.components.durationScore - a.scoreInfo.components.durationScore;
            }
            return b.scoreInfo.score - a.scoreInfo.score;
        });

        // Debug top matches
        console.debug(`\n📊 Top 5 Matches:`);
        scoredCandidates.slice(0, 5).forEach(({ candidate, scoreInfo }, index) => {
            const attrs = candidate?.attributes || candidate;
            const { score, components, durations, reason } = scoreInfo;

            const durInfo = durations.query && durations.candidate ?
                `${durations.candidate.toFixed(1)}s (Δ${Math.abs(durations.query - durations.candidate).toFixed(1)}s)` :
                'N/A';

            console.debug(
                `${index + 1}. [${score.toFixed(4)}] "${attrs.artistName || attrs.artist}" - "${attrs.name || attrs.title}"\n` +
                `   Album: "${attrs.albumName || attrs.album || 'N/A'}" | Duration: ${durInfo}\n` +
                `   T:${components.titleScore.toFixed(3)} A:${components.artistScore.toFixed(3)} ` +
                `Al:${components.albumScore.toFixed(3)} D:${components.durationScore.toFixed(3)}\n` +
                `   ${reason || 'No reason'}`
            );
        });

        // Enhanced selection logic
        const bestMatch = scoredCandidates[0];
        const confidenceThreshold = 0.70; // Adjusted threshold for better accuracy

        if (bestMatch.scoreInfo.score < confidenceThreshold) {
            console.debug(`\n❌ NO MATCH: Best score ${bestMatch.scoreInfo.score.toFixed(4)} < threshold ${confidenceThreshold}`);
            return null;
        }

        // Check for ambiguous matches
        if (scoredCandidates.length > 1) {
            const secondBest = scoredCandidates[1];
            const scoreGap = bestMatch.scoreInfo.score - secondBest.scoreInfo.score;

            // If scores are very close and neither is very high, it's ambiguous
            if (scoreGap < 0.05 && bestMatch.scoreInfo.score < 0.9) {
                console.debug(`\n⚠️  AMBIGUOUS: Score gap ${scoreGap.toFixed(4)} is too small`);
                console.debug(`   Best: ${bestMatch.scoreInfo.score.toFixed(4)} vs Second: ${secondBest.scoreInfo.score.toFixed(4)}`);
                // Pick a random candidate from the top 2 if ambiguous
                if (scoreGap < 0.05) {
                    const selectedAmbiguousMatch = scoredCandidates[0];
                    console.debug(`Picking first: "${selectedAmbiguousMatch.candidate?.attributes?.artistName || selectedAmbiguousMatch.candidate?.artist}" - "${selectedAmbiguousMatch.candidate?.attributes?.name || selectedAmbiguousMatch.candidate?.title}"`);
                    return selectedAmbiguousMatch;
                }
            }
        }

        // Final validation for exact matches
        const attrs = bestMatch.candidate?.attributes || bestMatch.candidate;
        const titleAnalysis = this.analyzeTitle(queryTitle);
        const candTitleAnalysis = this.analyzeTitle(attrs.name || attrs.title);

        // Extra validation for high-confidence matches
        if (bestMatch.scoreInfo.score > 0.9) {
            if (titleAnalysis.baseTitle === candTitleAnalysis.baseTitle) {
                console.debug(`\n✅ EXACT MATCH CONFIRMED: "${attrs.artistName || attrs.artist}" - "${attrs.name || attrs.title}"`);
                console.debug(`   Score: ${bestMatch.scoreInfo.score.toFixed(4)} | ${bestMatch.scoreInfo.reason}`);
                return bestMatch;
            }
        }

        console.debug(`\n✅ SELECTED: "${attrs.artistName || attrs.artist}" - "${attrs.name || attrs.title}"`);
        console.debug(`   Score: ${bestMatch.scoreInfo.score.toFixed(4)} | ${bestMatch.scoreInfo.reason}`);

        return bestMatch;
    }
}
