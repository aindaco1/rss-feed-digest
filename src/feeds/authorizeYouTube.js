import crypto from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export async function authorizeYouTube(options = {}) {
  const env = options.env || process.env;
  const clientId = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET before running YouTube authorization.");
  }
  validateOAuthClientId(clientId);

  const port = Number(options.port || env.YOUTUBE_OAUTH_PORT || 53682);
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = crypto.randomBytes(24).toString("hex");
  const authorizationUrl = buildAuthorizationUrl({ clientId, redirectUri, state });

  console.log("Open this URL and approve read-only YouTube access:");
  console.log(authorizationUrl);
  console.log(`\nWaiting for Google OAuth callback on ${redirectUri}`);

  const code = await waitForAuthorizationCode({ port, state });
  const token = await exchangeCodeForToken({ clientId, clientSecret, code, redirectUri, fetchImpl: options.fetchImpl || fetch });

  if (token.refresh_token) {
    console.log("\nAdd this value as the YOUTUBE_REFRESH_TOKEN secret:");
    console.log(token.refresh_token);
  } else {
    console.warn("\nNo refresh token was returned. Re-run with a fresh consent grant, or revoke access and try again.");
  }

  return token;
}

export function buildAuthorizationUrl({ clientId, redirectUri, state }) {
  validateOAuthClientId(clientId);

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

function validateOAuthClientId(clientId) {
  if (!/\.apps\.googleusercontent\.com$/i.test(String(clientId || ""))) {
    throw new Error(
      "YOUTUBE_CLIENT_ID must be an OAuth client ID ending in .apps.googleusercontent.com, not an API key, project ID, client secret, or app name."
    );
  }
}

async function waitForAuthorizationCode({ port, state }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const url = new URL(request.url, `http://127.0.0.1:${port}`);

        if (url.pathname !== "/oauth2callback") {
          response.writeHead(404).end("Not found");
          return;
        }

        if (url.searchParams.get("state") !== state) {
          response.writeHead(400).end("Invalid OAuth state.");
          throw new Error("Invalid OAuth state.");
        }

        const error = url.searchParams.get("error");
        if (error) {
          response.writeHead(400).end(`OAuth error: ${error}`);
          throw new Error(`OAuth error: ${error}`);
        }

        const code = url.searchParams.get("code");
        if (!code) {
          response.writeHead(400).end("Missing OAuth code.");
          throw new Error("Missing OAuth code.");
        }

        response.writeHead(200, { "content-type": "text/plain" }).end("Authorization complete. You can close this tab.");
        server.close();
        resolve(code);
      } catch (error) {
        server.close();
        reject(error);
      }
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri, fetchImpl }) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`YouTube authorization failed: ${payload.error_description || payload.error || response.status}`);
  }

  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await authorizeYouTube();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
