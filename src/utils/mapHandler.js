
function timeToMs(timeStr) {
  const parts = timeStr.split(":");
  let hours = 0, minutes = 0, seconds = 0, milliseconds = 0;
  if (parts.length === 3) {
    hours = parseInt(parts[0]);
    minutes = parseInt(parts[1]);
    const secParts = parts[2].split(".");
    seconds = parseInt(secParts[0]);
    milliseconds = secParts.length > 1 ? parseInt(secParts[1]) : 0;
  } else if (parts.length === 2) {
    minutes = parseInt(parts[0]);
    const secParts = parts[1].split(".");
    seconds = parseInt(secParts[0]);
    milliseconds = secParts.length > 1 ? parseInt(secParts[1]) : 0;
  } else if (parts.length === 1 && timeStr.includes(".")) {
    const secParts = parts[0].split(".");
    seconds = parseInt(secParts[0]);
    milliseconds = secParts.length > 1 ? parseInt(secParts[1]) : 0;
  } else {
    throw new Error(`Unexpected time format: ${timeStr}`);
  }
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
}


/**
 * Konversi format LRCLIB API menjadi format JSON yang diinginkan
 * @param {Object} data - Data dari API LRC
 * @returns {Object} - Data JSON hasil konversi
 */
export function convertLRCLIBtoJSON(data) {
  // Ambil data syncedLyrics dari input API
  const syncedLyrics = data.syncedLyrics || '';
  const duration = data.duration * 1000; // ubah durasi ke ms
  const lines = syncedLyrics.split('\n');
  const beats = [0];

  let lyrics = [];
  let currentTime = 0;
  let lineOffset = 0;

  // Generate beats hingga durasi akhir
  for (let i = beats[beats.length - 1] + 1000; i <= duration; i += 1000) {
    beats.push(i);
  }

  lines.forEach((line, index) => {
    // Ekstrak timestamp dan teks
    const match = line.match(/^\[(\d+):(\d+)\.(\d+)]\s*(.*)$/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3], 10);
      const text = match[4];

      // Hitung waktu dalam milidetik
      const time = minutes * 60000 + seconds * 1000 + milliseconds;

      // Buat elemen lirik
      lyrics.push({
        time,
        duration: 0, // Default, diatur di iterasi berikutnya
        text,
        isLineEnding: 1,
        element: {
          key: `L${lineOffset + 1}`,
          songPart: "",
          singer: "",
        },
      });

      currentTime = time;
      lineOffset++;
    }
  });

  // Set durasi tiap line kecuali line terakhir
  for (let i = 0; i < lyrics.length - 1; i++) {
    lyrics[i].duration = lyrics[i + 1].time - lyrics[i].time;
  }
  // Untuk baris terakhir, set durasi hingga akhir lagu
  if (lyrics.length > 0) {
    lyrics[lyrics.length - 1].duration = duration - lyrics[lyrics.length - 1].time;
  }

  const filteredLyrics = lyrics.filter(item => item.text !== '')

  // JSON output
  return {
    MapName: `${data.id}`,
    KpoeTools: "1.31-LPlusBcknd",
    Artist: data.artistName || "KPoe Template Artist",
    Title: data.trackName || "KPoe Template Name",
    Sync: "line",
    Information: "This Maps Are Converted By Server-side",
    lyricsColor: "#ffffff",
    lyrics: filteredLyrics,
  };
}

/**
 * Converts Apple Music's word-synced TTML format to a structured JSON object.
 * This refactored version improves readability and maintainability without changing the core parsing logic.
 *
 * @param {string} ttml - The raw TTML content as a string.
 * @param {number} [offset=0] - An optional offset in milliseconds to apply to all timestamps.
 * @param {boolean} [separate=false] - A legacy flag to control text node handling (behavior preserved from original).
 * @returns {object} - A JSON object containing metadata and an array of lyric objects.
 */
export function convertTTMLtoJSON(ttml, offset = 0, separate = false) {
  // --- Constants for Regex and Magic Strings ---
  const REGEX = {
    TIMING_MODE: /<tt\b[^>]*itunes:timing="([^"]+)"/i,
    METADATA: /<head>[\s\S]*?<metadata>([\s\S]*?)<\/metadata>/i,
    ITUNES_METADATA: /<iTunesMetadata\b([^>]*)>([\s\S]*?)<\/iTunesMetadata>/i,
    LEADING_SILENCE: /leadingSilence="([^"]+)"/i,
    SONGWRITERS: /<songwriters>([\s\S]*?)<\/songwriters>/i,
    SONGWRITER: /<songwriter>([\s\S]*?)<\/songwriter>/gi,
    DIV: /<(?:tt:)?div\b([^>]*)>([\s\S]*?)<\/(?:tt:)?div>/gi,
    P: /<(?:tt:)?p\b([^>]*)>([\s\S]*?)<\/(?:tt:)?p>/gi,
    SPAN: /<(?:tt:)?span[^>]*?begin="([^"]+)"[^>]*?end="([^"]+)"[^>]*>([\s\S]*?)<\/(?:tt:)?span>/gi,
    BG_SPAN_WRAPPER: /<(?:tt:)?span[^>]*?role="x-bg"[^>]*>([\s\S]*?<\/(?:tt:)?span>)<\/(?:tt:)?span>/gi,
    BEGIN: /begin="([^"]+)"/i,
    END: /end="([^"]+)"/i,
    SONG_PART: /itunes:songPart="([^"]+)"/i,
    KEY: /itunes:key="([^"]+)"/i,
    AGENT: /ttm:agent="([^"]+)"/i,
    TEXT_TAIL: /^([^<]+)/,
  };

  /**
   * Parses all span elements within a given piece of content.
   * This handles both main and background vocals and encapsulates the repeated logic.
   */
  const parseSpans = (content, baseElement) => {
    const spans = [];
    let spanMatch;
    // The regex needs to be re-created here because of the /g flag's statefulness.
    const spanRegex = new RegExp(REGEX.SPAN.source, 'gi');

    while ((spanMatch = spanRegex.exec(content)) !== null) {
      const [, beginTime, endTime, spanText] = spanMatch;
      let accumulatedText = spanText;

      // This logic handles text nodes that are not wrapped in a <span>,
      // which can occur with beautified/formatted TTML. It preserves the original's behavior.
      const tailSearch = content.substring(spanRegex.lastIndex);
      const tailMatch = tailSearch.match(REGEX.TEXT_TAIL);
      if (tailMatch && !separate) {
        accumulatedText += tailMatch[1];
      }

      spans.push({
        time: timeToMs(beginTime) + offset,
        duration: timeToMs(endTime) - timeToMs(beginTime),
        text: accumulatedText,
        isLineEnding: 0, // Will be corrected to 1 for the last element of a <p> later.
        element: { ...baseElement },
      });

      if (separate && tailMatch) {
         spans.push({
            time: timeToMs(beginTime) + (timeToMs(endTime) - timeToMs(beginTime)) + offset,
            duration: 0,
            text: tailMatch[1],
            isLineEnding: 0,
            element: {},
         });
      }
    }
    return spans;
  };

  /**
   * Extracts metadata from the TTML header.
   */
  const parseMetadata = (ttmlContent) => {
    const metadata = { source: "Apple Music", songWriters: [] };
    const metadataMatch = ttmlContent.match(REGEX.METADATA);
    if (!metadataMatch) return metadata;

    const metadataContent = metadataMatch[1];
    const itunesMatch = metadataContent.match(REGEX.ITUNES_METADATA);
    if (!itunesMatch) return metadata;

    const itunesAttrs = itunesMatch[1];
    const lsMatch = itunesAttrs.match(REGEX.LEADING_SILENCE);
    if (lsMatch) metadata.leadingSilence = lsMatch[1];

    const songwritersMatch = itunesMatch[2].match(REGEX.SONGWRITERS);
    if (songwritersMatch) {
      let songwriterMatch;
      while ((songwriterMatch = REGEX.SONGWRITER.exec(songwritersMatch[1])) !== null) {
        metadata.songWriters.push(songwriterMatch[1].trim());
      }
    }
    return metadata;
  };

  // --- Main Execution ---

  const metadata = parseMetadata(ttml);
  const timingModeMatch = ttml.match(REGEX.TIMING_MODE);
  const timingMode = timingModeMatch ? timingModeMatch[1] : "Word";
  if (timingMode === "Line") {
    console.warn("[WARNING] This TTML is not Synced Word-by-Word (timing mode is 'Line')");
  }

  const lyrics = [];
  let divMatch;
  while ((divMatch = REGEX.DIV.exec(ttml)) !== null) {
    const [/*full*/, divAttrs, divContent] = divMatch;
    const songPartMatch = divAttrs.match(REGEX.SONG_PART);
    const songPart = songPartMatch ? songPartMatch[1] : "";

    let pMatch;
    while ((pMatch = REGEX.P.exec(divContent)) !== null) {
      const [/*full*/, pAttrs, pContent] = pMatch;

      const keyMatch = pAttrs.match(REGEX.KEY);
      const agentMatch = pAttrs.match(REGEX.AGENT);

      // This is the base element data for all spans within this <p> tag.
      const elementBase = {
        key: keyMatch ? keyMatch[1] : "",
        songPart: songPart,
        singer: agentMatch ? agentMatch[1].replace('voice', 'v') : "",
      };

      if (timingMode === "Line") {
        const beginMatch = pAttrs.match(REGEX.BEGIN);
        const endMatch = pAttrs.match(REGEX.END);
        if (!beginMatch || !endMatch) continue;

        lyrics.push({
          time: timeToMs(beginMatch[1]) + offset,
          duration: timeToMs(endMatch[1]) - timeToMs(beginMatch[1]),
          text: pContent.replace(/<[^>]*>/g, ""),
          isLineEnding: 1,
          element: elementBase,
        });
      } else { // Word Timing Mode
        const pStartIndex = lyrics.length;

        // Separate background vocals from main vocals.
        const bgSpanWrappers = [...pContent.matchAll(REGEX.BG_SPAN_WRAPPER)];
        const mainContent = pContent.replace(REGEX.BG_SPAN_WRAPPER, '');

        // 1. Process main vocals.
        const mainSpans = parseSpans(mainContent, { ...elementBase });
        lyrics.push(...mainSpans);

        // 2. Process background vocals.
        for (const bgMatch of bgSpanWrappers) {
          const bgContent = bgMatch[1]; // The inner content of the x-bg span wrapper
          const bgSpans = parseSpans(bgContent, { ...elementBase, isBackground: true });
          lyrics.push(...bgSpans);
        }
        
        // 3. The last lyric chunk of a <p> element is always the end of the line.
        if (lyrics.length > pStartIndex) {
          lyrics[lyrics.length - 1].isLineEnding = 1;
        }
      }
    }
  }

  return {
    type: timingMode,
    KpoeTools: "1.44-JSRegex",
    metadata: metadata,
    lyrics: lyrics,
  };
}

// V1 to V2
export function v1Tov2(data) {
  const groupedLyrics = [];
  let currentGroup = null;

  // Handle different types: Word, Syllable, or Line
  if (data.type === "Line") {
    // For Line type, each segment is already a complete line
    data.lyrics.forEach(segment => {
      const lineItem = {
        time: segment.time,
        duration: segment.duration,
        text: segment.text,
        syllabus: [], // Empty syllabus for Line type
        element: segment.element || { key: "", songPart: "", singer: "" }
      };
      groupedLyrics.push(lineItem);
    });
  } else {
    // For Word or Syllable types, group by line endings
    data.lyrics.forEach(segment => {
      if (!currentGroup) {
        currentGroup = {
          time: segment.time,
          duration: 0, // Will calculate duration at the end of the group
          text: "", // Initialize text for the whole line
          syllabus: [],
          element: segment.element || { key: "", songPart: "", singer: "" }
        };
      }

      // Add to the line's text
      currentGroup.text += segment.text;

      // Add to syllables
      const syllabusEntry = {
        time: segment.time,
        duration: segment.duration,
        text: segment.text
      };

      if (segment.element && segment.element.isBackground === true) {
        syllabusEntry.isBackground = true;
      }

      currentGroup.syllabus.push(syllabusEntry);

      // If this is line ending, finalize the current group
      if (segment.isLineEnding === 1) {
        // Find the earliest and latest syllable times to calculate duration properly
        let earliestTime = Infinity;
        let latestEndTime = 0;

        currentGroup.syllabus.forEach(syllable => {
          // Find the earliest start time
          if (syllable.time < earliestTime) {
            earliestTime = syllable.time;
          }

          // Find the latest end time
          const endTime = syllable.time + syllable.duration;
          if (endTime > latestEndTime) {
            latestEndTime = endTime;
          }
        });

        // Update the group's start time and duration
        currentGroup.time = earliestTime;
        currentGroup.duration = latestEndTime - earliestTime;

        // Remove trailing space if any
        currentGroup.text = currentGroup.text.trim();

        groupedLyrics.push(currentGroup);
        currentGroup = null;
      }
    });

    // Don't forget the last group if it wasn't ended with isLineEnding flag
    if (currentGroup) {
      // Find the earliest and latest syllable times to calculate duration properly
      let earliestTime = Infinity;
      let latestEndTime = 0;

      currentGroup.syllabus.forEach(syllable => {
        // Find the earliest start time
        if (syllable.time < earliestTime) {
          earliestTime = syllable.time;
        }

        // Find the latest end time
        const endTime = syllable.time + syllable.duration;
        if (endTime > latestEndTime) {
          latestEndTime = endTime;
        }
      });

      // Update the group's start time and duration
      currentGroup.time = earliestTime;
      currentGroup.duration = latestEndTime - earliestTime;

      currentGroup.text = currentGroup.text.trim();
      groupedLyrics.push(currentGroup);
    }
  }

  return {
    type: data.type == "syllable" ? "Word" : data.type,
    KpoeTools: '1.31R2-LPlusBcknd,' + data.KpoeTools,
    metadata: data.metadata,
    ignoreSponsorblock: data.ignoreSponsorblock || undefined,
    lyrics: groupedLyrics,
    cached: data.cached || 'None'
  };
}


/**
 * JSON to Apple TTML Converter
 * 
 * This script converts the JSON format from Apple Music lyrics to TTML format.
 * Includes support for backing vocals using x-bg role as a group container.
 * 
 * @param {Object} jsonLyrics - The JSON lyrics object
 * @returns {String} - The TTML formatted XML string
 */
export function convertJsonToTTML(jsonLyrics) {
  // Helper function to format time
  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = Math.round(ms % 1000);

    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    } else {
      return `${seconds}.${milliseconds.toString().padStart(3, '0')}`;
    }
  };
  
  // Create the TTML root element with proper namespaces
  let ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:lang="id">`;

  // Add the head section
  ttml += '<head><metadata>';
  ttml += '<ttm:agent type="person" xml:id="v1"/>';

  // Add metadata with proper namespace
  const leadingSilence = jsonLyrics.metadata?.leadingSilence || 0;
  ttml += `<itunes:metadata leadingSilence="${leadingSilence}">`;
  ttml += '<songwriters>';
  
  // Handle songwriters safely
  if (jsonLyrics.metadata && Array.isArray(jsonLyrics.metadata.songWriters)) {
    jsonLyrics.metadata.songWriters.forEach(songwriter => {
      ttml += `<songwriter>${songwriter}</songwriter>`;
    });
  }
  
  ttml += '</songwriters>';
  ttml += '</itunes:metadata>';
  ttml += '</metadata></head>';

  // Calculate total duration from the last lyric
  const lastLyric = jsonLyrics.lyrics[jsonLyrics.lyrics.length - 1];
  const totalDurationMs = lastLyric.time + lastLyric.duration;
  const formattedDuration = formatTime(totalDurationMs);

  // Start the body section with the total duration
  ttml += `<body dur="${formattedDuration}">`;

  // Single div for all lyrics
  ttml += '<div>';

  // Process each lyric
  jsonLyrics.lyrics.forEach(lyric => {
    const lyricBegin = formatTime(lyric.time);
    const lyricEnd = formatTime(lyric.time + lyric.duration);
    const singer = lyric.element.singer || "v1";
    const key = lyric.element.key || "";
    const songPart = lyric.element.songPart || "";

    // Add the paragraph for this lyric
    ttml += `<p begin="${lyricBegin}" end="${lyricEnd}" itunes:key="${key}" ttm:agent="${singer}" itunes:songPart="${songPart}">`;

    // Process syllables only if they exist
    if (Array.isArray(lyric.syllabus) && lyric.syllabus.length > 0) {
      // Find background vocal sections
      let bgSections = [];
      let currentBgSection = null;
      
      lyric.syllabus.forEach((syl, idx) => {
        if (syl.isBackground && currentBgSection === null) {
          currentBgSection = { start: idx, end: idx };
        } else if (syl.isBackground && currentBgSection !== null) {
          currentBgSection.end = idx;
        } else if (!syl.isBackground && currentBgSection !== null) {
          bgSections.push(currentBgSection);
          currentBgSection = null;
        }
      });
      
      if (currentBgSection !== null) {
        bgSections.push(currentBgSection);
      }
      
      let currentPos = 0;
      
      for (const section of bgSections) {
        if (currentPos < section.start) {
          for (let i = currentPos; i < section.start; i++) {
            const syl = lyric.syllabus[i];
            const syllableBegin = formatTime(syl.time);
            const syllableEnd = formatTime(syl.time + syl.duration);
            const isSyllable = i > 0 && !lyric.syllabus[i-1].text.endsWith(' ') && !syl.text.startsWith(' ');
            const prefix = isSyllable ? '' : ' ';
            
            ttml += `${prefix}<span begin="${syllableBegin}" end="${syllableEnd}">${syl.text.trim()}</span>`;
          }
        }
        
        ttml += '<span ttm:role="x-bg">';
        for (let i = section.start; i <= section.end; i++) {
          const syl = lyric.syllabus[i];
          const syllableBegin = formatTime(syl.time);
          const syllableEnd = formatTime(syl.time + syl.duration);
          const isSyllable = i > 0 && !lyric.syllabus[i-1].text.endsWith(' ') && !syl.text.startsWith(' ');
          const prefix = isSyllable ? '' : ' ';
          
          ttml += `${prefix}<span begin="${syllableBegin}" end="${syllableEnd}">${syl.text.trim()}</span>`;
        }
        ttml += '</span>';
        
        currentPos = section.end + 1;
      }
      
      if (currentPos < lyric.syllabus.length) {
        for (let i = currentPos; i < lyric.syllabus.length; i++) {
          const syl = lyric.syllabus[i];
          const syllableBegin = formatTime(syl.time);
          const syllableEnd = formatTime(syl.time + syl.duration);
          const isSyllable = i > 0 && !lyric.syllabus[i-1].text.endsWith(' ') && !syl.text.startsWith(' ');
          const prefix = isSyllable ? '' : ' ';
          
          ttml += `${prefix}<span begin="${syllableBegin}" end="${syllableEnd}">${syl.text.trim()}</span>`;
        }
      }
    }

    // Close the paragraph
    ttml += '</p>';
  });

  // Close the div 
  ttml += '</div>';

  // Close the body and tt tags
  ttml += '</body></tt>';

  return ttml;
}
