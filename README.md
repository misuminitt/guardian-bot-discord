<h1 align="center">guardian-bot-discord</h1>

<p align="center">
  <img src="https://img.shields.io/badge/node.js-18+-339933.svg">
  <img src="https://img.shields.io/badge/discord.js-14-5865F2.svg">
  <img src="https://img.shields.io/badge/dotenv-17-ECD53F.svg">
  <img src="https://img.shields.io/badge/status-active-success.svg">
</p>

A Discord moderation bot focused on automod, warning management, logging, and configurable punishments for server safety.

## Technology Stack
- `node.js`
- `discord.js`
- `dotenv`

## Requirements
- Node.js 18+
- npm
- Discord Bot Token + Application ID + Guild ID

## Installation
### 1. Clone repository
```bash
git clone https://github.com/misuminitt/guardian-bot-discord.git
cd guardian-bot-discord
```

### 2. Install dependencies
```bash
npm install
```

### 3. Setup environment
```bash
cp .env.example .env
```

Make sure these values are set in `.env`:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `BANWORDS` (optional, comma-separated)

## Usage
Run bot:
```bash
npm start
```

Key commands:
- `/setmodlog`
- `/warn`, `/warnings`, `/removewarn`, `/clearwarnings`
- `/mute`, `/unmute`, `/kick`, `/ban`, `/unban`, `/purge`
- `/automod-config ...`
- `/automod-forcetest ...`

## Author
misuminitt
