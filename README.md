<h1 align="center">misuminitt Portfolio Dashboard</h1>

<p align="center">
  <img src="https://img.shields.io/badge/next.js-16-black.svg">
  <img src="https://img.shields.io/badge/react-19-61DAFB.svg">
  <img src="https://img.shields.io/badge/typescript-5+-3178C6.svg">
  <img src="https://img.shields.io/badge/prisma-6-2D3748.svg">
  <img src="https://img.shields.io/badge/status-active-success.svg">
</p>

A personal portfolio focused on CTF writeups, certifications, and skills showcase, powered by a custom admin dashboard.

## About Me
I am **Muhammad Ridwan Kusumahani**, a cybersecurity enthusiast and CTF player focused on practical writeups, secure engineering, and continuous learning.

## Technology Stack
- `next`
- `react`
- `typescript`
- `prisma`
- `@prisma/client`
- `jose`

## Requirements
- Node.js 18+
- npm
- SQLite (local Prisma setup)

## Installation
### 1. Clone repository
```bash
git clone https://github.com/misuminitt/misuminitt.github.io.git
cd misuminitt.github.io
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
- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `NEXT_PUBLIC_ADMIN_PATH`

## Author
misuminitt
