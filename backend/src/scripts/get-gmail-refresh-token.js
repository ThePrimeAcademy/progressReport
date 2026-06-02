// scripts/get-gmail-refresh-token.js
// One-time helper to grab a Gmail API refresh token for the backend.
//
// PREREQUISITES (do these once in Google Cloud Console):
//   1. Create a new project (or reuse one) at https://console.cloud.google.com
//   2. Enable the "Gmail API" for the project.
//   3. Configure OAuth consent screen:
//        - User type: External
//        - App name: anything (e.g. "ProgressReport")
//        - User support email + developer contact: your gmail
//        - Scopes: leave default (we ask for gmail.send at runtime)
//        - Test users: add your gmail address (the one you'll send FROM)
//   4. Create credentials > OAuth client ID:
//        - Application type: Desktop app
//        - Name: anything
//      Note the "Client ID" and "Client secret".
//
// USAGE:
//   cd backend
//   GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." node src/scripts/get-gmail-refresh-token.js
//
// The script will print a URL. Open it, sign in with the Gmail account you
// want to send FROM (must be one of the test users you added above), click
// Allow. The refresh token will be printed in your terminal. Paste it into
// Railway as GOOGLE_REFRESH_TOKEN.

const http = require('http');
const url = require('url');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const PORT = 8088;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n  Missing env vars. Run with:\n');
  console.error('    GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." node src/scripts/get-gmail-refresh-token.js\n');
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // forces a refresh token even on repeat runs
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname !== '/oauth2callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const code = parsed.query.code;
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing ?code in callback');
      return;
    }

    const { tokens } = await oAuth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:sans-serif;padding:40px;">
        <h2 style="color:#15803d;">Got your refresh token.</h2>
        <p>Switch back to your terminal to copy it. You can close this tab.</p>
      </body></html>
    `);

    console.log('\n  --------------------------------------------------------------');
    console.log('  SUCCESS — paste this into Railway as GOOGLE_REFRESH_TOKEN:\n');
    console.log('  ' + tokens.refresh_token);
    console.log('\n  --------------------------------------------------------------\n');
    if (!tokens.refresh_token) {
      console.warn('  (no refresh_token returned — re-run after revoking access at');
      console.warn('   https://myaccount.google.com/permissions; we force prompt=consent');
      console.warn('   so this should not normally happen.)');
    }
    server.close(() => setTimeout(() => process.exit(0), 200));
  } catch (e) {
    console.error('Error exchanging code:', e.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(e.message);
  }
});

server.listen(PORT, () => {
  console.log('\n  Open this URL in your browser, sign in, and click Allow:\n');
  console.log('  ' + authUrl + '\n');
  console.log(`  Listening for the OAuth callback on http://localhost:${PORT} ...\n`);
});
