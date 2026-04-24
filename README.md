# Student Council Attendance — 2026–2027

A multi-user attendance system for student council, deployable on Railway.

---

## Deploy to Railway (step by step)

### Step 1 — Put the project on GitHub

1. Go to [github.com](https://github.com) and sign in (or create a free account).
2. Click the **+** button in the top right → **New repository**.
3. Name it `student-council-attendance`, set it to **Private**, click **Create repository**.
4. Download the free app **GitHub Desktop** from [desktop.github.com](https://desktop.github.com).
5. Open GitHub Desktop → **Add an Existing Repository from your Hard Drive**.
6. Point it to this folder (the one containing `server.js`).
7. Click **Publish repository** — make sure **Keep this code private** is checked.

### Step 2 — Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with your GitHub account.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your `student-council-attendance` repository.
4. Railway will detect Node.js and start building automatically.
5. Once deployed, click your project → **Settings** → **Networking** → **Generate Domain**.
6. Copy that URL — that's your live link to share with everyone!

### Step 3 — Set environment variables on Railway (important!)

In your Railway project, go to **Variables** and add:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | Any long random string, e.g. `sc2027xK9mPqLzRv` |
| `DB_PATH` | `/data/attendance.db` |

Then go to **Volumes** → **Add Volume** → mount path `/data`. This makes your database persist across deploys.

---

## Default login

- **Exec password:** `council2027`
- Change it immediately after first login via **Members → Change exec password**

---

## How it works

| Who | Can do |
|---|---|
| Anyone (member view) | View attendance, history, overview |
| Member (identified) | Mark their own attendance within 24h of meeting start |
| Exec Board (password) | Everything — add/edit/delete meetings, manage members, approve excuses |

Members identify themselves by clicking **Login** and selecting their name. This is stored in their browser session tab — they'll need to re-select if they close the tab.

---

## Project structure

```
attendance-app/
├── server.js          # Express backend + all API routes
├── package.json       # Dependencies
├── railway.toml       # Railway deploy config
├── .gitignore
└── public/
    └── index.html     # Full frontend
```

---

## Running locally (optional)

```bash
npm install
npm start
# Open http://localhost:3000
```
