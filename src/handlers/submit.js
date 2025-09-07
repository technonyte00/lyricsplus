
// src/handlers/submit.js
import { SignJWT, jwtVerify } from "jose";
import { createJsonResponse } from "../utils/responseHelper.js";
import { LyricsPlusService } from "../services/lyricsPlusService.js";
import { JWT_SECRET } from "../config.js";
import GoogleDrive from "../utils/googleDrive.js";

const gd = new GoogleDrive();

const POW_DIFFICULTY = 5; 
const POW_CHALLENGE_EXPIRATION = '240s';

async function createChallengeToken(challenge, secret) {
    const secretKey = new TextEncoder().encode(secret);
    return await new SignJWT({ challenge })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(POW_CHALLENGE_EXPIRATION)
        .sign(secretKey);
}

async function verifyChallengeToken(token, secret) {
    try {
        const secretKey = new TextEncoder().encode(secret);
        const { payload } = await jwtVerify(token, secretKey);
        return payload;
    } catch (error) {
        return null;
    }
}

async function verifyProofOfWork(challenge, nonce, difficulty) {
    const textEncoder = new TextEncoder();
    const data = textEncoder.encode(challenge + nonce);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const requiredPrefix = '0'.repeat(difficulty);
    return hashHex.startsWith(requiredPrefix);
}

export async function handleChallenge(request, env, ctx) {
    if (!JWT_SECRET) {
        console.error("CRITICAL: JWT_SECRET is not configured in config.js.");
        return createJsonResponse({ error: "Server configuration error" }, 500);
    }

    const challenge = crypto.randomUUID();
    const token = await createChallengeToken(challenge, JWT_SECRET);

    return createJsonResponse({
        token,
        difficulty: POW_DIFFICULTY
    }, 200);
}

export async function handleSubmit(request, env, ctx) {
    try {
        const payload = request.body;
        const { proofOfWorkToken, nonce, ...lyricsSubmitData } = payload;

        if (!proofOfWorkToken || nonce === undefined) {
            return createJsonResponse({ error: "Missing proof of work" }, 400);
        }

        if (!JWT_SECRET) {
            console.error("CRITICAL: JWT_SECRET is not configured in config.js.");
            return createJsonResponse({ error: "Server configuration error" }, 500);
        }

        const challengePayload = await verifyChallengeToken(proofOfWorkToken, JWT_SECRET);
        if (!challengePayload) {
            return createJsonResponse({ error: "Invalid or expired proof of work token" }, 400);
        }

        const isProofValid = await verifyProofOfWork(challengePayload.challenge, nonce, POW_DIFFICULTY);
        if (!isProofValid) {
            return createJsonResponse({ error: "Invalid proof of work solution" }, 400);
        }

        const { songTitle, songArtist, songAlbum, songDuration, lyricsData, forceUpload } = lyricsSubmitData;
        if (!songTitle || !songArtist || !songDuration || !lyricsData) {
            return createJsonResponse({ error: "Missing required parameters" }, 400);
        }

        const result = await LyricsPlusService.uploadTimelineLyrics(
            gd,
            songTitle,
            songArtist,
            songAlbum || "",
            songDuration,
            lyricsData,
            forceUpload || false
        );

        return createJsonResponse(result, result.success ? 200 : 400);
    } catch (error) {
        console.error("Error in /v1/lyricsplus/submit:", error);
        return createJsonResponse({ error: error.message }, 500);
    }
}
