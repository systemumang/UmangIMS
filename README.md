<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/479db784-1bff-4d22-a44d-2532d28870b4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Local URLs

- App UI: `http://localhost:3000/`
- API base: `http://localhost:3000/api`
- Excel export: `http://localhost:3000/api/requests.xlsx`

## Data storage

- Primary DB (SQLite): `data/purchase_system.sqlite` (auto-created on first run)
- Excel snapshot: `data/purchase_workflow.xlsx` (auto-saved after each transaction; if the file is open/locked, it will be skipped until you close Excel)
- Masters Excel snapshot: `data/master_data.xlsx` (auto-saved after each change; if the file is open/locked, it will be skipped until you close Excel)
