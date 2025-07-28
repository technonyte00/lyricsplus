export function handleApiError(error) {
    return new Error(error.error?.message || "Unknown Google API error." + error);
  }
  