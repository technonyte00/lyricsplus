// src/utils/responseHelper.js
import { corsHeaders } from "../middleware/corsMiddleware.js";

export const createJsonResponse = (data, status = 200, extraHeaders = {}) => {
    return {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: data
    };
  };


export const createErrorResponse = (message, status = 400, extraHeaders = {}) => {
    return createJsonResponse({ error: message }, status, extraHeaders);
};
