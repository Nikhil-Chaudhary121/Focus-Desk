# Focus Desk

Todo list + habit tracker + always-on-top widget + hourly water reminder.

## Run it
1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal in this folder and run:
   ```
   npm install
   npm start
   ```

## Make a real .exe installer (Windows)
```
npm run build
```
The installer appears in the `dist` folder.

## How to use
- **Tasks tab**: type a task, attach links or apps, click Add task.
  - Link example: `https://youtube.com/watch?v=...`
  - App example (Windows): `chrome`, `code`, `code "D:\my-website"`, or a full path like `"C:\Program Files\...\app.exe"`
- **Start and open** launches everything attached to the task and marks it In progress.
- **Habits tab**: add habits, tick them daily, see streak and last 7 days.
- **Widget** (small window, always on top): drag the top bar to move it. The arrow button collapses it to a thin bar and expands it again.
- **Water reminder**: fires every 60 minutes after you open the app (change it in Settings).

Your data is saved on your PC in a `data.json` file:
- Windows: `%APPDATA%\focus-desk\data.json`
