// src/utils/requestChecker.js

// Helper function to determine if a user agent is a typical browser
export function isBrowserUserAgent(userAgent) {
    // This is a simplified check. A more robust solution might use a library.
    // Common browser indicators: "Mozilla", "Chrome", "Safari", "Firefox", "Edge"
    // Common non-browser indicators: "curl", "Postman", "Go-http-client", "Python-urllib"
    const browserIndicators = ['Mozilla', 'Chrome', 'Safari', 'Firefox', 'Edge'];
    const nonBrowserIndicators = ['curl', 'Postman', 'Go-http-client', 'Python-urllib', 'Dalvik', 'okhttp'];

    const lowerCaseUserAgent = userAgent.toLowerCase();

    // Check for common browser indicators
    for (const indicator of browserIndicators) {
        if (lowerCaseUserAgent.includes(indicator.toLowerCase())) {
            return true;
        }
    }

    // Check for common non-browser indicators
    for (const indicator of nonBrowserIndicators) {
        if (lowerCaseUserAgent.includes(indicator.toLowerCase())) {
            return false;
        }
    }

    // If no clear indicators, assume it's not a browser for stricter rate limiting
    return false;
}
