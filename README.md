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

This version supports Google sign-in.

Set this Vercel environment variable:

`GOOGLE_CLIENT_ID`

Per-user API keys are stored in that signed-in user's browser settings, keyed by their Google account email. That keeps one user's keys separate from another user's keys. If you want true server-side storage across devices, we should add a database next.

The app treats those saved keys like a private workspace secret store for that signed-in account. It is not a literal deployment environment variable per user, but it behaves that way inside the app.

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
- If you want true server-side per-user secret storage, we should add a database or secret store next.
