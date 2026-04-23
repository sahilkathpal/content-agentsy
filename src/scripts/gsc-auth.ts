/**
 * One-time setup script to get a GSC OAuth2 refresh token.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com
 *   2. Create a project (or use existing)
 *   3. Enable "Google Search Console API"
 *   4. Create OAuth 2.0 credentials (Desktop app type)
 *   5. Add GSC_CLIENT_ID and GSC_CLIENT_SECRET to .env
 *
 * Usage:
 *   npx tsx src/scripts/gsc-auth.ts
 *
 * This opens a browser for Google login, then prints the refresh token
 * to add to your .env file.
 */

import "dotenv/config";
import { createServer } from "node:http";

const CLIENT_ID = process.env.GSC_CLIENT_ID;
const CLIENT_SECRET = process.env.GSC_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GSC_CLIENT_ID and GSC_CLIENT_SECRET in .env first.");
  console.error("\nSteps:");
  console.error("  1. https://console.cloud.google.com → APIs & Services → Credentials");
  console.error('  2. Create OAuth 2.0 Client ID (Application type: "Desktop app")');
  console.error("  3. Add to .env:");
  console.error("     GSC_CLIENT_ID=...");
  console.error("     GSC_CLIENT_SECRET=...");
  process.exit(1);
}

const REDIRECT_PORT = 8374;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl.toString());
console.log("\nWaiting for callback...\n");

// Start local server to catch the redirect
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Auth failed: ${error}</h2><p>You can close this tab.</p>`);
    console.error(`Auth error: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h2>No code received</h2>");
    return;
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json() as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (tokenData.error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed</h2><p>${tokenData.error_description}</p>`);
    console.error(`Token error: ${tokenData.error_description}`);
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<h2>Success! You can close this tab.</h2>");

  console.log("Add these to your .env:\n");
  console.log(`GSC_REFRESH_TOKEN=${tokenData.refresh_token}`);
  console.log(`GSC_SITE_URL=https://codeongrass.com`);
  console.log("\n(Use sc-domain:codeongrass.com if your property is domain-level)");

  server.close();
  process.exit(0);
});

import { exec } from "node:child_process";

server.listen(REDIRECT_PORT, () => {
  exec(`open "${authUrl.toString()}"`);
});
