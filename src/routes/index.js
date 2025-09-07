
// src/routes/index.js
import { handleLyricsGet, handleLyricsGetV2, handleTtmlGet } from '../handlers/lyrics.js';
import { handleMetadataGet } from '../handlers/metadata.js';
import { handleChallenge, handleSubmit } from '../handlers/submit.js';
import { handleMusixmatchTest } from '../handlers/test.js';
import { handleSonglistSearch } from '../handlers/songCatalog.js';

const routes = [
    {
        method: 'GET',
        path: '/v1/lyrics/get',
        handler: handleLyricsGet
    },
    {
        method: 'GET',
        path: '/v2/lyrics/get',
        handler: handleLyricsGetV2
    },
    {
        method: 'GET',
        path: '/v1/ttml/get',
        handler: handleTtmlGet
    },
    {
        method: 'GET',
        path: '/v1/songlist/search',
        handler: handleSonglistSearch
    },
    {
        method: 'GET',
        path: '/v1/metadata/get',
        handler: handleMetadataGet
    },
    {
        method: 'GET',
        path: '/v1/lyricsplus/challenge',
        handler: handleChallenge
    },
    {
        method: 'POST',
        path: '/v1/lyricsplus/submit',
        handler: handleSubmit
    },
    {
        method: 'GET',
        path: '/v1/test/musixmatch',
        handler: handleMusixmatchTest
    }
];

export default routes;
