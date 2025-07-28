export const GDRIVE = {
    USERS_FILE_ID: process.env.GDRIVE_USERS_FILE_ID || "", // Not Used
    SONGS_FILE_ID: process.env.GDRIVE_SONGS_FILE_ID || "", // a songlist.json
    CACHED_SPOTIFY: process.env.GDRIVE_CACHED_SPOTIFY || "", //Spotify
    CACHED_TTML: process.env.GDRIVE_CACHED_TTML || "", //Apple Music
    USERTML_JSON: process.env.GDRIVE_USERTML_JSON || "", //Lyrics+ (UGC Timelines)
    CACHED_MUSIXMATCH: process.env.GDRIVE_CACHED_MUSIXMATCH || "", //Musixmatch
    API_URL: "https://www.googleapis.com/drive/v3/files/",
    API_URL_UPDATE: "https://www.googleapis.com/upload/drive/v2/files/",
};

export const AUTH_KEY = {
    //Google Drive Auth Key
    CLIENT_ID: process.env.AUTH_KEY_CLIENT_ID || "",
    CLIENT_SECRET: process.env.AUTH_KEY_CLIENT_SECRET || "",
    REFRESH_TOKEN: process.env.AUTH_KEY_REFRESH_TOKEN || "",
    ROOT: process.env.AUTH_KEY_ROOT || "",
};

export const APPLE_MUSIC = {
    // Set to "web" for web authentication or "android" for Android authentication
    AUTH_TYPE: "android",
    BASE_URL: "https://amp-api.music.apple.com/v1",
    EDGE_BASE_URL: "https://amp-api-edge.music.apple.com/v1",
    // "web" config
    MUSIC_AUTH_TOKEN: process.env.APPLE_MUSIC_AUTH_TOKEN || "",
    // "android" config
    ANDROID_DSID: process.env.APPLE_MUSIC_ANDROID_DSID || "21981080509",
    ANDROID_USER_AGENT: process.env.APPLE_MUSIC_ANDROID_USER_AGENT || "Music/6.1 Android/15 model/XiaomiPOCOF1 build/1451 (dt:66)",
    ANDROID_AUTH_TOKEN: process.env.APPLE_MUSIC_ANDROID_AUTH_TOKEN || "",
    ANDROID_COOKIE: process.env.APPLE_MUSIC_ANDROID_COOKIE || ""
};

export const SPOTIFY = {
    BASE_URL: "https://api.spotify.com/v1",
    LYRICS_URL: "https://spclient.wg.spotify.com/color-lyrics/v2/track/",
    AUTH_URL: "https://accounts.spotify.com/api/token",
    TOKEN_URL: "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
    // put your spotify token here
    CLIENT_ID: process.env.SPOTIFY_CLIENT_ID || "",
    CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET || "",
    COOKIE: process.env.SPOTIFY_COOKIE || ""
};

export const JWT_SECRET = process.env.JWT_SECRET || "lyricsplus-opensource";
