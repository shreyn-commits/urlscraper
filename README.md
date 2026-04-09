# CSV AI Spreadsheet

A tiny browser-based spreadsheet for working with CSV files and running a prompt across a chosen column using either OpenAI or Claude.

## What it does

- Import a CSV file
- Edit cells directly in the browser
- Rename headers
- Export the updated sheet back to CSV
- Run a prompt over each cell in a selected column and write the result into a new AI output column

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

- The current UI runs the prompt row-by-row for the selected column and writes the responses into a new column.
- If you want batch processing, row-level controls, file persistence, or formula support, this can be extended next.
