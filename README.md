# CSV AI Spreadsheet

A tiny browser-based spreadsheet for working with CSV files and running prompts across rows and columns using either OpenAI or Claude.

## What it does

- Import a CSV file
- Edit cells directly in the browser
- Rename headers
- Export the updated sheet back to CSV
- Run prompts over selected rows or columns
- Inspect structured JSON responses
- Create separate columns from JSON fields such as `confidence`

## Google Login

This version supports Google sign-in through Firebase Auth.

Set these Vercel environment variables:

`FIREBASE_API_KEY`
`FIREBASE_AUTH_DOMAIN`
`FIREBASE_PROJECT_ID`
`FIREBASE_STORAGE_BUCKET`
`FIREBASE_MESSAGING_SENDER_ID`
`FIREBASE_APP_ID`
`FIREBASE_MEASUREMENT_ID` optional

In Firebase, enable:

- Google as an Auth provider
- Firestore for the database
- Your Vercel domain in Auth authorized domains

Per-user API keys and settings are stored in Firestore under the signed-in user's Firebase Auth uid. That keeps one user's workspace separate from another user's workspace and syncs across devices.

For Firestore security, use the included `firestore.rules` so each signed-in user can only read and write their own document.

## Run it

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## API setup

The app uses a local proxy server so API keys stay off the page.

- OpenAI: choose `OpenAI`, enter your API key, and optionally override the model.
- Claude: choose `Claude`, enter your API key, and optionally override the model.

## Notes

- The UI is being tightened toward a Clay-style workflow.
- AI columns now support predefining output fields like `decision`, `confidence`, and `reason`, then filling them from JSON results.
- Firestore is now the per-user database layer for saved API keys, models, and sheet settings.
