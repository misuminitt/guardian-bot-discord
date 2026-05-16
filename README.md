# Discord Moderation Bot (Node.js)

Bot ini fokus untuk moderasi server dan AutoMod yang bisa diatur via slash command.

## Fitur Utama
- AutoMod untuk deteksi pelanggaran chat
- Auto delete pesan pelanggaran (bisa ON/OFF)
- Auto warn, auto mute, auto kick berdasarkan jumlah pelanggaran
- Manual moderation commands (`/warn`, `/mute`, `/ban`, dll)
- DM otomatis ke user yang kena tindakan moderasi
- Channel log moderasi + activity log global

## Rule AutoMod
Rule yang dideteksi:
- Pipe spam: `|||` atau `| |` / `| | |`
- Underscore spam: `_ _` / `_ _ _`
- Link `https://imgur.com/`
- Frasa `free skin` (case-insensitive)
- Banword list (bisa diatur)
- Mention `@everyone` non-admin
- Spam gambar melebihi threshold dalam window waktu tertentu

## Alur Punishment
- Pelanggaran akan masuk warning counter user.
- Jika warning user sudah **3 kali**, user akan **auto-kick**.
- Setelah auto-kick, warning counter user di-reset ke 0.
- Riwayat log tetap ada di channel log.

## Appeal Contact (DM Bot)
Saat user kena warn/mute/ban/kick, bot kirim DM dan mengarahkan appeal ke:
- `<@812290843511488582>`
- `<@328048748120899586>`

## Slash Commands
### Umum
- `/ping`
- `/halo`
- `/help`

### Moderasi Manual
- `/setmodlog channel:#channel`
- `/warn user:@user reason:...`
- `/warnings user:@user`
- `/removewarn user:@user warn_id:<id>`
- `/clearwarnings user:@user`
- `/mute user:@user minutes:... reason:...`
- `/unmute user:@user`
- `/ban user:@user reason:...`
- `/unban userid:1234567890`
- `/kick user:@user reason:...`
- `/purge amount:1-100`

### Force Test AutoMod
- `/automod-forcetest add user:@user`
- `/automod-forcetest remove user:@user`
- `/automod-forcetest list`

### Konfigurasi AutoMod (Tanpa Ubah Kode)
- `/automod-config view`
- `/automod-config set warn_before_mute:<angka> mute_minutes:<angka> delete_message:<true/false> autoban_enabled:<true/false> autoban_warn_threshold:<angka>`
- `/automod-config set-banword action:<warn|mute|ban> mute_minutes:<angka>`
- `/automod-config set-image limit:<angka> window_sec:<angka>`
- `/automod-config banword-add word:<kata>`
- `/automod-config banword-remove word:<kata>`
- `/automod-config banword-list`

## Logging
### Masuk ke log channel (`/setmodlog`)
- Warn/mute/ban/kick/unban/purge
- Message create/edit/delete
- Channel create/delete/update
- Role create/delete/update
- Thread create/delete/update
- Guild ban add/remove

### Tidak masuk ke log
- Member join/leave
- Voice state logs
- Command usage logs

## Permissions yang Dibutuhkan
Aktifkan minimal di bot role / OAuth permissions:
- `View Channels`
- `Send Messages`
- `Read Message History`
- `Manage Messages`
- `Moderate Members`
- `Kick Members`
- `Ban Members`

Di Developer Portal -> Bot:
- `Message Content Intent` = ON

## Environment Variables
Contoh `.env`:
```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_server_id
BANWORDS=anjing,kontol,asu,babi,tai,bangsat
```

## Jalankan
```bash
npm install
npm start
```

## Catatan Penting
- Role bot harus di atas role target untuk mute/kick/ban.
- Jika token sempat terekspos, segera reset token di Discord Developer Portal.
