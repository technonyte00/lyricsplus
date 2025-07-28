# LyricsPlus Backend

This is the backend for the LyricsPlus service. It is a robust and versatile lyrics provider that scrapes and serves lyrics from various sources, including Apple Music, Musixmatch, and Spotify. It also features a system for users to submit their own synchronized lyrics. The backend is designed for high availability and scalability, with support for deployment on both Vercel and Cloudflare Workers.

## Features

*   **Multi-Source Scraping**: Aggregates lyrics from major providers to ensure the best coverage and quality.
*   **User Submissions**: Allows users to contribute by submitting their own synchronized lyrics.
*   **Advanced Similarity Matching**: Utilizes sophisticated algorithms to accurately match songs across different services, even with variations in titles, artists, and album information.
*   **Caching**: Caches lyrics on Google Drive to reduce redundant scraping and improve response times.
*   **Dual Runtime Environments**: The application is architected to run in two distinct environments:
    *   **Cloudflare Workers**: Using `src/index-wrangler.js` as the entry point for a high-performance, serverless edge environment.
    *   **Node.js / Express**: Using `src/index.js` as the entry point, allowing it to run as a standard Node.js application on platforms like Vercel, Heroku, or any traditional server.
*   **Deployment Flexibility**: Can be deployed as a serverless function on Vercel or as a Cloudflare Worker.

## How It Works

The backend exposes a set of API endpoints to fetch lyrics and other metadata. When a request is received, it queries the supported sources in a prioritized order. The results are then processed, normalized, and the best available lyrics are returned to the client.

The service prioritizes lyrics with word-level synchronization for a richer user experience. If a song is not found in the cache, the backend will scrape the sources, and the best result will be cached on Google Drive for future requests.

## API Endpoints

The primary API endpoints are defined in `src/routes/index.js`. Some of the key endpoints include:

*   `GET /v1/lyrics/get`: Fetches lyrics for a song.
*   `GET /v2/lyrics/get`: Fetches lyrics in a different format.
*   `GET /v1/ttml/get`: Fetches lyrics in TTML format.
*   `GET /v1/metadata/get`: Fetches song metadata.
*   `POST /v1/lyricsplus/submit`: Allows users to submit lyrics.

## Deployment

This backend is configured for deployment on two platforms:

*   **Vercel**: The `vercel.json` file contains the configuration for deploying the application as a serverless Node.js function.
*   **Cloudflare Workers**: The `wrangler.toml` file is used to configure and deploy the application as a Cloudflare Worker.

This dual-deployment strategy allows for flexibility and redundancy.

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

## License

This project is licensed under the Apache License 2.0.
