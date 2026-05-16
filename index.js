require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token) {
  console.error('DISCORD_TOKEN belum diset di .env');
  process.exit(1);
}

if (!clientId || !guildId) {
  console.error('CLIENT_ID atau GUILD_ID belum diset di .env');
  process.exit(1);
}

const ADMIN_ROLE_ID = '1074541056810569868';
const EXEMPT_BOT_ROLE_ID = '1383144055323496480';
const APPEAL_CONTACT_USER_ID = '812290843511488582';
const APPEAL_CONTACT_USER_ID_2 = '328048748120899586';
const AUTO_KICK_WARN_THRESHOLD = 3;

const DEFAULT_BANWORDS = ['kontol', 'memek', 'ngentot', 'anjing', 'babi'];
const ENV_BANWORDS = (process.env.BANWORDS || DEFAULT_BANWORDS.join(','))
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

const settingsFilePath = path.join(__dirname, 'settings.json');

let modLogChannelId = null;
const recentImageSpam = new Map();
const warningStore = new Map();
const forcedAutoModUserIds = new Set([APPEAL_CONTACT_USER_ID]);

const automodConfig = {
  deleteMessage: true,
  warnBeforeMute: 1,
  muteMinutes: 30,
  autoBanEnabled: false,
  autoBanWarnThreshold: 4,
  imageSpamWindowSec: 10,
  imageSpamLimit: 2,
  banwordAction: 'mute',
  banwordMuteMinutes: 30,
  banwords: new Set(ENV_BANWORDS),
};

function serializeWarningStore() {
  const result = {};
  for (const [userId, value] of warningStore.entries()) {
    result[userId] = value;
  }
  return result;
}

function saveSettings() {
  try {
    const payload = {
      modLogChannelId,
      automodConfig: {
        deleteMessage: automodConfig.deleteMessage,
        warnBeforeMute: automodConfig.warnBeforeMute,
        muteMinutes: automodConfig.muteMinutes,
        autoBanEnabled: automodConfig.autoBanEnabled,
        autoBanWarnThreshold: automodConfig.autoBanWarnThreshold,
        imageSpamWindowSec: automodConfig.imageSpamWindowSec,
        imageSpamLimit: automodConfig.imageSpamLimit,
        banwordAction: automodConfig.banwordAction,
        banwordMuteMinutes: automodConfig.banwordMuteMinutes,
        banwords: [...automodConfig.banwords],
      },
      forcedAutoModUserIds: [...forcedAutoModUserIds],
      warningStore: serializeWarningStore(),
    };

    fs.writeFileSync(settingsFilePath, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Gagal simpan settings.json:', error.message);
  }
}

function loadSettings() {
  try {
    if (!fs.existsSync(settingsFilePath)) return;

    const raw = fs.readFileSync(settingsFilePath, 'utf8');
    const data = JSON.parse(raw);

    if (typeof data.modLogChannelId === 'string') {
      modLogChannelId = data.modLogChannelId;
    }

    if (data.automodConfig && typeof data.automodConfig === 'object') {
      const cfg = data.automodConfig;
      if (typeof cfg.deleteMessage === 'boolean') automodConfig.deleteMessage = cfg.deleteMessage;
      if (Number.isInteger(cfg.warnBeforeMute)) automodConfig.warnBeforeMute = cfg.warnBeforeMute;
      if (Number.isInteger(cfg.muteMinutes)) automodConfig.muteMinutes = cfg.muteMinutes;
      if (typeof cfg.autoBanEnabled === 'boolean') automodConfig.autoBanEnabled = cfg.autoBanEnabled;
      if (Number.isInteger(cfg.autoBanWarnThreshold)) automodConfig.autoBanWarnThreshold = cfg.autoBanWarnThreshold;
      if (Number.isInteger(cfg.imageSpamWindowSec)) automodConfig.imageSpamWindowSec = cfg.imageSpamWindowSec;
      if (Number.isInteger(cfg.imageSpamLimit)) automodConfig.imageSpamLimit = cfg.imageSpamLimit;
      if (typeof cfg.banwordAction === 'string') automodConfig.banwordAction = cfg.banwordAction;
      if (Number.isInteger(cfg.banwordMuteMinutes)) automodConfig.banwordMuteMinutes = cfg.banwordMuteMinutes;
      if (Array.isArray(cfg.banwords)) automodConfig.banwords = new Set(cfg.banwords.map((w) => String(w).toLowerCase()));
    }

    if (Array.isArray(data.forcedAutoModUserIds)) {
      forcedAutoModUserIds.clear();
      for (const id of data.forcedAutoModUserIds) forcedAutoModUserIds.add(String(id));
    }

    if (data.warningStore && typeof data.warningStore === 'object') {
      warningStore.clear();
      for (const [userId, value] of Object.entries(data.warningStore)) {
        warningStore.set(userId, {
          count: Number.isInteger(value?.count) ? value.count : 0,
          nextWarnId: Number.isInteger(value?.nextWarnId) ? value.nextWarnId : 1,
          history: Array.isArray(value?.history) ? value.history : [],
        });
      }
    }
  } catch (error) {
    console.error('Gagal load settings.json:', error.message);
  }
}

function ensureWarningState(userId) {
  if (!warningStore.has(userId)) {
    warningStore.set(userId, { count: 0, history: [], nextWarnId: 1 });
  }
  return warningStore.get(userId);
}

function addWarning(userId, moderatorId, reason) {
  const data = ensureWarningState(userId);
  const warnId = data.nextWarnId || 1;
  data.nextWarnId = warnId + 1;
  data.count += 1;
  data.history.push({ id: warnId, at: Date.now(), moderatorId, reason, removed: false });
  warningStore.set(userId, data);
  saveSettings();
  return data;
}

function resetWarningCounter(userId) {
  const data = ensureWarningState(userId);
  data.count = 0;
  warningStore.set(userId, data);
  saveSettings();
}

function removeWarningById(userId, warnId) {
  const data = warningStore.get(userId);
  if (!data) return { ok: false, reason: 'no_data' };

  const entry = data.history.find((h) => h.id === warnId && !h.removed);
  if (!entry) return { ok: false, reason: 'not_found' };

  entry.removed = true;
  if (data.count > 0) data.count -= 1;
  warningStore.set(userId, data);
  saveSettings();
  return { ok: true, entry, count: data.count };
}

function memberIsExempt(member) {
  if (!member) return true;
  if (forcedAutoModUserIds.has(member.id)) return false;
  if (member.user.bot) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.has(ADMIN_ROLE_ID) || member.roles.cache.has(EXEMPT_BOT_ROLE_ID);
}

function getAppealContactText() {
  return `<@${APPEAL_CONTACT_USER_ID}> atau <@${APPEAL_CONTACT_USER_ID_2}>`;
}

function short(text, max = 300) {
  if (!text) return '-';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function getMatchedBanWords(text) {
  const lower = (text || '').toLowerCase();
  const matches = [];

  for (const word of automodConfig.banwords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lower)) matches.push(word);
  }

  return matches;
}

function containsPipeSpam(text) {
  return /\|{3,}/.test(text) || /\|\s+\|(?:\s+\|)*/.test(text);
}

function containsDoubleUnderscore(text) {
  return /_\s+_(?:\s+_)*/.test(text);
}

function containsImgurLink(text) {
  return (text || '').toLowerCase().includes('https://imgur.com/');
}

function containsFreeSkinPhrase(text) {
  return /free\s*skin/i.test(text || '');
}

function containsEveryoneMention(message) {
  return (message.content || '').includes('@everyone');
}

function getAttachmentLikeCount(message) {
  const attachments = message.attachments?.size || 0;
  const embedImages = (message.embeds || []).filter((e) => e.data?.image || e.data?.thumbnail).length;
  return attachments + embedImages;
}

function isImageBurstSpam(message) {
  const count = getAttachmentLikeCount(message);
  if (count === 0) return false;

  const now = Date.now();
  const state = recentImageSpam.get(message.author.id) || { timestamps: [] };
  state.timestamps = state.timestamps.filter((ts) => now - ts <= automodConfig.imageSpamWindowSec * 1000);
  for (let i = 0; i < count; i += 1) state.timestamps.push(now);

  recentImageSpam.set(message.author.id, state);
  return state.timestamps.length > automodConfig.imageSpamLimit;
}

function formatAutoModConfig() {
  return [
    `delete_message: ${automodConfig.deleteMessage}`,
    `warn_before_mute: ${automodConfig.warnBeforeMute}`,
    `mute_minutes: ${automodConfig.muteMinutes}`,
    `autoban_enabled: ${automodConfig.autoBanEnabled}`,
    `autoban_warn_threshold: ${automodConfig.autoBanWarnThreshold}`,
    `image_spam_limit: ${automodConfig.imageSpamLimit}`,
    `image_spam_window_sec: ${automodConfig.imageSpamWindowSec}`,
    `banword_action: ${automodConfig.banwordAction}`,
    `banword_mute_minutes: ${automodConfig.banwordMuteMinutes}`,
    `banwords_count: ${automodConfig.banwords.size}`,
  ].join('\n');
}

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Balas Pong!'),
  new SlashCommandBuilder().setName('halo').setDescription('Sapa bot'),
  new SlashCommandBuilder().setName('help').setDescription('Lihat daftar command'),

  new SlashCommandBuilder()
    .setName('setmodlog')
    .setDescription('Set channel log moderasi bot')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel untuk log moderasi')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn user')
    .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Alasan warn').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Lihat warning aktif user')
    .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('removewarn')
    .setDescription('Hapus warning tertentu berdasarkan ID')
    .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true))
    .addIntegerOption((option) =>
      option.setName('warn_id').setDescription('ID warning yang mau dihapus').setRequired(true).setMinValue(1),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Reset warning aktif user ke 0')
    .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute user (timeout)')
    .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true))
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription('Durasi menit (default dari config)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10080),
    )
    .addStringOption((option) => option.setName('reason').setDescription('Alasan mute').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Buka mute user')
    .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick user dari server')
    .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Alasan kick').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban user dari server')
    .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Alasan ban').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban user by ID')
    .addStringOption((option) => option.setName('userid').setDescription('ID user yang di-unban').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Hapus banyak pesan sekaligus')
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Jumlah pesan (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('automod-forcetest')
    .setDescription('Kelola user yang dipaksa tetap kena AutoMod')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Tambah user ke list force-test')
        .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Hapus user dari list force-test')
        .addUserOption((option) => option.setName('user').setDescription('User target').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Lihat daftar user force-test'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('automod-config')
    .setDescription('Atur setting AutoMod tanpa ubah kode')
    .addSubcommand((sub) => sub.setName('view').setDescription('Lihat konfigurasi AutoMod saat ini'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set konfigurasi umum AutoMod')
        .addIntegerOption((o) => o.setName('warn_before_mute').setDescription('Pelanggaran ke berapa baru mute').setMinValue(1).setMaxValue(20).setRequired(false))
        .addIntegerOption((o) => o.setName('mute_minutes').setDescription('Durasi mute default').setMinValue(1).setMaxValue(10080).setRequired(false))
        .addBooleanOption((o) => o.setName('delete_message').setDescription('Auto hapus pesan pelanggaran').setRequired(false))
        .addBooleanOption((o) => o.setName('autoban_enabled').setDescription('Aktifkan auto ban berdasar total warning').setRequired(false))
        .addIntegerOption((o) => o.setName('autoban_warn_threshold').setDescription('Ban saat warning mencapai angka ini').setMinValue(1).setMaxValue(100).setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-banword')
        .setDescription('Set punishment khusus banword')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Aksi untuk banword')
            .addChoices(
              { name: 'warn', value: 'warn' },
              { name: 'mute', value: 'mute' },
              { name: 'ban', value: 'ban' },
            )
            .setRequired(true),
        )
        .addIntegerOption((o) => o.setName('mute_minutes').setDescription('Durasi mute jika action=mute').setMinValue(1).setMaxValue(10080).setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-image')
        .setDescription('Set threshold spam gambar')
        .addIntegerOption((o) => o.setName('limit').setDescription('Maks gambar dalam window').setMinValue(1).setMaxValue(20).setRequired(true))
        .addIntegerOption((o) => o.setName('window_sec').setDescription('Window detik').setMinValue(1).setMaxValue(120).setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('banword-add')
        .setDescription('Tambah banword')
        .addStringOption((o) => o.setName('word').setDescription('Kata terlarang').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('banword-remove')
        .setDescription('Hapus banword')
        .addStringOption((o) => o.setName('word').setDescription('Kata terlarang').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('banword-list').setDescription('Lihat daftar banword'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

async function sendModLog(guild, text) {
  if (!modLogChannelId) return;
  const channel = guild.channels.cache.get(modLogChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  try {
    await channel.send(text);
  } catch (error) {
    console.error('Gagal kirim mod log:', error.message);
  }
}

async function sendActivityLog(guild, text) {
  await sendModLog(guild, `🧾 ${text}`);
}

async function sendModerationDM(user, payload) {
  const { action, reason, guildName, durationMinutes, warningCount } = payload;
  const lines = [
    `Kamu terkena tindakan moderasi di server **${guildName}**.`,
    `Tindakan: **${action}**`,
    `Alasan: ${reason || 'Tidak disebutkan'}`,
  ];

  if (typeof warningCount === 'number') lines.push(`Total warning kamu saat ini: **${warningCount}**`);
  if (durationMinutes) lines.push(`Durasi: **${durationMinutes} menit**`);
  lines.push(`Jika kamu merasa ini salah, silakan DM ${getAppealContactText()}.`);

  try {
    await user.send(lines.join('\n'));
  } catch (error) {
    console.error(`Gagal kirim DM moderasi ke ${user.id}:`, error.message);
  }
}

async function applyWarnAction(member, guild, reason, moderatorId = client.user.id) {
  const data = addWarning(member.id, moderatorId, reason);
  await sendModerationDM(member.user, {
    action: 'Warn',
    reason,
    guildName: guild.name,
    warningCount: data.count,
  });
  await sendModLog(guild, `⚠️ Warn: <@${member.id}> | Warn #${data.count} | ${reason}`);
  return data;
}

async function applyMuteAction(member, guild, reason, minutes) {
  if (!member.moderatable) {
    await sendModLog(guild, `⚠️ Tidak bisa mute <@${member.id}> (cek hierarchy). Alasan: ${reason}`);
    return false;
  }

  await member.timeout(minutes * 60 * 1000, reason);
  await sendModerationDM(member.user, {
    action: 'Mute',
    reason,
    guildName: guild.name,
    durationMinutes: minutes,
  });
  await sendModLog(guild, `🔇 Mute: <@${member.id}> ${minutes} menit | ${reason}`);
  return true;
}

async function applyBanAction(memberOrUser, guild, reason, moderatorId = client.user.id) {
  const user = memberOrUser.user || memberOrUser;
  const member = memberOrUser.user ? memberOrUser : null;

  if (member && !member.bannable) {
    await sendModLog(guild, `⚠️ Tidak bisa ban <@${user.id}> (cek hierarchy). Alasan: ${reason}`);
    return false;
  }

  await sendModerationDM(user, {
    action: 'Ban',
    reason,
    guildName: guild.name,
  });

  await guild.members.ban(user.id, { reason: `By <@${moderatorId}> | ${reason}` });
  await sendModLog(guild, `⛔ Ban: <@${user.id}> | ${reason}`);
  return true;
}

async function applyKickAction(member, guild, reason, moderatorId = client.user.id) {
  if (!member?.kickable) {
    await sendModLog(guild, `⚠️ Tidak bisa kick <@${member?.id || 'unknown'}> (cek hierarchy). Alasan: ${reason}`);
    return false;
  }

  await sendModerationDM(member.user, {
    action: 'Kick',
    reason,
    guildName: guild.name,
  });

  await member.kick(`By <@${moderatorId}> | ${reason}`);
  await sendModLog(guild, `👢 Kick: <@${member.id}> | ${reason}`);
  resetWarningCounter(member.id);
  await sendModLog(guild, `🧹 Warning counter direset untuk <@${member.id}> setelah kick (riwayat log tetap ada).`);
  return true;
}

async function handleAutoModeration(message) {
  if (!message.guild || !message.member) return;
  if (memberIsExempt(message.member)) return;

  const me = message.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ModerateMembers)) return;

  const text = message.content || '';
  const reasons = [];
  const matchedBanwords = getMatchedBanWords(text);
  const hitBanword = matchedBanwords.length > 0;

  if (containsPipeSpam(text)) reasons.push('pipe spam (||| / | |)');
  if (containsDoubleUnderscore(text)) reasons.push('underscore spam (_ _)');
  if (containsImgurLink(text)) reasons.push('imgur link spam');
  if (containsFreeSkinPhrase(text)) reasons.push('promosi free skin');
  if (hitBanword) reasons.push(`banword / kata terlarang: ${matchedBanwords.map((w) => `\`${w}\``).join(', ')}`);
  if (containsEveryoneMention(message)) reasons.push('@everyone non-admin');
  if (isImageBurstSpam(message)) reasons.push(`spam gambar > ${automodConfig.imageSpamLimit} dalam ${automodConfig.imageSpamWindowSec} detik`);

  if (reasons.length === 0) return;

  if (automodConfig.deleteMessage) {
    try {
      await message.delete();
    } catch {
      return;
    }
  }

  const reasonText = reasons.join(', ');

  if (hitBanword) {
    if (automodConfig.banwordAction === 'ban') {
      await applyBanAction(message.member, message.guild, `AutoMod banword: ${reasonText}`);
      return;
    }

    if (automodConfig.banwordAction === 'mute') {
      const warningData = await applyWarnAction(message.member, message.guild, `AutoMod banword: ${reasonText}`);
      if (warningData.count >= AUTO_KICK_WARN_THRESHOLD) {
        await applyKickAction(message.member, message.guild, `AutoKick: warning mencapai ${warningData.count} (threshold ${AUTO_KICK_WARN_THRESHOLD})`);
        return;
      }
      await applyMuteAction(message.member, message.guild, `AutoMod banword: ${reasonText}`, automodConfig.banwordMuteMinutes);

      if (automodConfig.autoBanEnabled && warningData.count >= automodConfig.autoBanWarnThreshold) {
        await applyBanAction(message.member, message.guild, `AutoBan: warning mencapai ${warningData.count}`);
      }
      return;
    }

    if (automodConfig.banwordAction === 'warn') {
      const warningData = await applyWarnAction(message.member, message.guild, `AutoMod banword: ${reasonText}`);
      if (warningData.count >= AUTO_KICK_WARN_THRESHOLD) {
        await applyKickAction(message.member, message.guild, `AutoKick: warning mencapai ${warningData.count} (threshold ${AUTO_KICK_WARN_THRESHOLD})`);
        return;
      }
      if (warningData.count >= automodConfig.warnBeforeMute) {
        await applyMuteAction(message.member, message.guild, `AutoMod escalation: ${reasonText}`, automodConfig.muteMinutes);
      }
      if (automodConfig.autoBanEnabled && warningData.count >= automodConfig.autoBanWarnThreshold) {
        await applyBanAction(message.member, message.guild, `AutoBan: warning mencapai ${warningData.count}`);
      }
      return;
    }
  }

  const warningData = await applyWarnAction(message.member, message.guild, `AutoMod: ${reasonText}`);

  if (warningData.count >= AUTO_KICK_WARN_THRESHOLD) {
    await applyKickAction(message.member, message.guild, `AutoKick: warning mencapai ${warningData.count} (threshold ${AUTO_KICK_WARN_THRESHOLD})`);
    return;
  }

  if (warningData.count >= automodConfig.warnBeforeMute) {
    await applyMuteAction(message.member, message.guild, `AutoMod: ${reasonText}`, automodConfig.muteMinutes);
  }

  if (automodConfig.autoBanEnabled && warningData.count >= automodConfig.autoBanWarnThreshold) {
    await applyBanAction(message.member, message.guild, `AutoBan: warning mencapai ${warningData.count}`);
  }
}

async function getGuildMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('Slash command terdaftar untuk guild ini.');
}

client.once('clientReady', () => {
  console.log(`Bot online sebagai ${client.user.tag}`);
  if (modLogChannelId) console.log(`Mod log channel aktif: ${modLogChannelId}`);
});

client.on('messageCreate', async (message) => {
  await handleAutoModeration(message);

  if (!message.guild) return;
  if (message.author.bot) return;
  if (modLogChannelId && message.channel.id === modLogChannelId) return;
  await sendActivityLog(message.guild, `Message: <@${message.author.id}> di <#${message.channel.id}> | ${short(message.content)}`);
});

client.on('messageDelete', async (message) => {
  if (!message.guild) return;
  if (message.author?.bot) return;
  await sendActivityLog(message.guild, `Delete: <@${message.author?.id || 'unknown'}> di <#${message.channel?.id || 'unknown'}> | ${short(message.content)}`);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  if (newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  await sendActivityLog(
    newMessage.guild,
    `Edit: <@${newMessage.author?.id || 'unknown'}> di <#${newMessage.channel?.id || 'unknown'}>\nbefore: ${short(oldMessage.content)}\nafter: ${short(newMessage.content)}`,
  );
});

client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  await sendActivityLog(channel.guild, `Channel dibuat: <#${channel.id}> (${channel.type})`);
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  await sendActivityLog(channel.guild, `Channel dihapus: #${channel.name || channel.id} (${channel.type})`);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  if (oldChannel.name === newChannel.name) return;
  await sendActivityLog(newChannel.guild, `Channel rename: #${oldChannel.name} -> #${newChannel.name}`);
});

client.on('roleCreate', async (role) => {
  await sendActivityLog(role.guild, `Role dibuat: @${role.name}`);
});

client.on('roleDelete', async (role) => {
  await sendActivityLog(role.guild, `Role dihapus: @${role.name}`);
});

client.on('roleUpdate', async (oldRole, newRole) => {
  if (oldRole.name === newRole.name) return;
  await sendActivityLog(newRole.guild, `Role rename: @${oldRole.name} -> @${newRole.name}`);
});

client.on('threadCreate', async (thread) => {
  await sendActivityLog(thread.guild, `Thread dibuat: ${thread.name} di <#${thread.parentId}>`);
});

client.on('threadDelete', async (thread) => {
  await sendActivityLog(thread.guild, `Thread dihapus: ${thread.name}`);
});

client.on('threadUpdate', async (oldThread, newThread) => {
  if (oldThread.name === newThread.name) return;
  await sendActivityLog(newThread.guild, `Thread rename: ${oldThread.name} -> ${newThread.name}`);
});

client.on('guildBanAdd', async (ban) => {
  await sendActivityLog(ban.guild, `Ban event: <@${ban.user.id}>`);
});

client.on('guildBanRemove', async (ban) => {
  await sendActivityLog(ban.guild, `Unban event: <@${ban.user.id}>`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'ping') return interaction.reply('Pong!');
  if (commandName === 'halo') return interaction.reply('Halo juga!');

  if (commandName === 'help') {
    return interaction.reply(
      'Command: /ping /halo /help /setmodlog /warn /warnings /removewarn /clearwarnings /mute /unmute /kick /ban /unban /purge /automod-forcetest /automod-config',
    );
  }

  if (commandName === 'setmodlog') {
    const channel = interaction.options.getChannel('channel', true);
    modLogChannelId = channel.id;
    saveSettings();
    return interaction.reply({ content: `Channel mod log diset ke <#${channel.id}>`, ephemeral: true });
  }

  if (commandName === 'warn') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Tidak disebutkan';
    const data = addWarning(user.id, interaction.user.id, reason);
    await sendModerationDM(user, { action: 'Warn (Manual)', reason, guildName: interaction.guild.name, warningCount: data.count });
    await sendModLog(interaction.guild, `⚠️ Manual Warn: <@${user.id}> | Oleh: <@${interaction.user.id}> | ${reason}`);
    return interaction.reply(`⚠️ <@${user.id}> diberi warn #${data.count}. Alasan: ${reason}`);
  }

  if (commandName === 'warnings') {
    const user = interaction.options.getUser('user', true);
    const data = warningStore.get(user.id);
    if (!data || data.count === 0) return interaction.reply(`📌 <@${user.id}> punya 0 warning aktif.`);

    const activeWarnings = data.history.filter((h) => !h.removed);
    const list = activeWarnings.slice(-10).map((h) => `- ID ${h.id}: ${h.reason}`).join('\n');
    return interaction.reply(`📌 <@${user.id}> punya ${data.count} warning aktif.\n${list}`);
  }

  if (commandName === 'removewarn') {
    const user = interaction.options.getUser('user', true);
    const warnId = interaction.options.getInteger('warn_id', true);

    const result = removeWarningById(user.id, warnId);
    if (!result.ok) {
      return interaction.reply({ content: `Warn ID ${warnId} tidak ditemukan untuk <@${user.id}>.`, ephemeral: true });
    }

    await sendModLog(interaction.guild, `🧽 Remove warn: <@${user.id}> | Warn ID ${warnId} dihapus oleh <@${interaction.user.id}> | Sisa warn aktif: ${result.count}`);
    return interaction.reply(`✅ Warn ID ${warnId} untuk <@${user.id}> berhasil dihapus. Sisa warn aktif: ${result.count}`);
  }

  if (commandName === 'clearwarnings') {
    const user = interaction.options.getUser('user', true);
    warningStore.delete(user.id);
    saveSettings();
    await sendModLog(interaction.guild, `🧹 Clear warnings: <@${user.id}> oleh <@${interaction.user.id}>`);
    return interaction.reply(`✅ Warning <@${user.id}> sudah direset.`);
  }

  if (commandName === 'mute') {
    const user = interaction.options.getUser('user', true);
    const minutes = interaction.options.getInteger('minutes') || automodConfig.muteMinutes;
    const reason = interaction.options.getString('reason') || 'Tidak disebutkan';
    const member = await getGuildMember(interaction.guild, user.id);
    if (!member) return interaction.reply({ content: 'User tidak ditemukan di server.', ephemeral: true });
    if (!member.moderatable) return interaction.reply({ content: 'User tidak bisa dimute (cek role hierarchy).', ephemeral: true });

    await member.timeout(minutes * 60 * 1000, reason);
    await sendModerationDM(user, { action: 'Mute (Manual)', reason, guildName: interaction.guild.name, durationMinutes: minutes });
    await sendModLog(interaction.guild, `🔇 Manual Mute: <@${user.id}> ${minutes} menit | Oleh: <@${interaction.user.id}> | ${reason}`);
    return interaction.reply(`🔇 <@${user.id}> dimute ${minutes} menit. Alasan: ${reason}`);
  }

  if (commandName === 'unmute') {
    const user = interaction.options.getUser('user', true);
    const member = await getGuildMember(interaction.guild, user.id);
    if (!member) return interaction.reply({ content: 'User tidak ditemukan di server.', ephemeral: true });
    await member.timeout(null, 'Manual unmute by moderator');
    await sendModLog(interaction.guild, `🔊 Manual Unmute: <@${user.id}> oleh <@${interaction.user.id}>`);
    return interaction.reply(`🔊 <@${user.id}> sudah di-unmute.`);
  }

  if (commandName === 'kick') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Tidak disebutkan';
    const member = await getGuildMember(interaction.guild, user.id);
    if (!member) return interaction.reply({ content: 'User tidak ditemukan di server.', ephemeral: true });
    if (!member.kickable) return interaction.reply({ content: 'User tidak bisa di-kick (cek role hierarchy).', ephemeral: true });

    await member.kick(reason);
    await sendModLog(interaction.guild, `👢 Manual Kick: <@${user.id}> | Oleh: <@${interaction.user.id}> | ${reason}`);
    return interaction.reply(`👢 <@${user.id}> di-kick. Alasan: ${reason}`);
  }

  if (commandName === 'ban') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Tidak disebutkan';
    const member = await getGuildMember(interaction.guild, user.id);
    if (member && !member.bannable) return interaction.reply({ content: 'User tidak bisa diban (cek role hierarchy).', ephemeral: true });

    await sendModerationDM(user, { action: 'Ban (Manual)', reason, guildName: interaction.guild.name });
    await interaction.guild.members.ban(user.id, { reason });
    await sendModLog(interaction.guild, `⛔ Manual Ban: <@${user.id}> | Oleh: <@${interaction.user.id}> | ${reason}`);
    return interaction.reply(`⛔ <@${user.id}> diban. Alasan: ${reason}`);
  }

  if (commandName === 'unban') {
    const userId = interaction.options.getString('userid', true).trim();
    await interaction.guild.members.unban(userId);
    await sendModLog(interaction.guild, `✅ Manual Unban: ${userId} oleh <@${interaction.user.id}>`);
    return interaction.reply(`✅ User dengan ID \`${userId}\` sudah di-unban.`);
  }

  if (commandName === 'purge') {
    const amount = interaction.options.getInteger('amount', true);
    const deleted = await interaction.channel.bulkDelete(amount, true);
    await sendModLog(interaction.guild, `🧹 Purge ${deleted.size} pesan oleh <@${interaction.user.id}> di <#${interaction.channel.id}>`);
    return interaction.reply({ content: `🧹 Berhasil hapus ${deleted.size} pesan.`, ephemeral: true });
  }

  if (commandName === 'automod-forcetest') {
    const sub = interaction.options.getSubcommand();
    const user = sub === 'list' ? null : interaction.options.getUser('user', true);

    if (sub === 'add') {
      forcedAutoModUserIds.add(user.id);
      saveSettings();
      return interaction.reply(`✅ <@${user.id}> ditambahkan ke force-test AutoMod.`);
    }

    if (sub === 'remove') {
      forcedAutoModUserIds.delete(user.id);
      saveSettings();
      return interaction.reply(`✅ <@${user.id}> dihapus dari force-test AutoMod.`);
    }

    const ids = [...forcedAutoModUserIds];
    if (ids.length === 0) return interaction.reply('List force-test kosong.');
    const list = ids.map((id) => `- <@${id}> (\`${id}\`)`).join('\n');
    return interaction.reply(`Daftar force-test AutoMod:\n${list}`);
  }

  if (commandName === 'automod-config') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      return interaction.reply({ content: `AutoMod Config:\n${formatAutoModConfig()}` });
    }

    if (sub === 'set') {
      const warnBeforeMute = interaction.options.getInteger('warn_before_mute');
      const muteMinutes = interaction.options.getInteger('mute_minutes');
      const deleteMessage = interaction.options.getBoolean('delete_message');
      const autoBanEnabled = interaction.options.getBoolean('autoban_enabled');
      const autoBanWarnThreshold = interaction.options.getInteger('autoban_warn_threshold');

      if (warnBeforeMute !== null) automodConfig.warnBeforeMute = warnBeforeMute;
      if (muteMinutes !== null) automodConfig.muteMinutes = muteMinutes;
      if (deleteMessage !== null) automodConfig.deleteMessage = deleteMessage;
      if (autoBanEnabled !== null) automodConfig.autoBanEnabled = autoBanEnabled;
      if (autoBanWarnThreshold !== null) automodConfig.autoBanWarnThreshold = autoBanWarnThreshold;
      saveSettings();

      return interaction.reply(`✅ AutoMod updated.\n${formatAutoModConfig()}`);
    }

    if (sub === 'set-banword') {
      const action = interaction.options.getString('action', true);
      const muteMinutes = interaction.options.getInteger('mute_minutes');
      automodConfig.banwordAction = action;
      if (muteMinutes !== null) automodConfig.banwordMuteMinutes = muteMinutes;
      saveSettings();

      return interaction.reply(`✅ Banword config updated.\nbanword_action: ${automodConfig.banwordAction}\nbanword_mute_minutes: ${automodConfig.banwordMuteMinutes}`);
    }

    if (sub === 'set-image') {
      automodConfig.imageSpamLimit = interaction.options.getInteger('limit', true);
      automodConfig.imageSpamWindowSec = interaction.options.getInteger('window_sec', true);
      saveSettings();
      return interaction.reply(`✅ Image spam config updated. limit=${automodConfig.imageSpamLimit}, window=${automodConfig.imageSpamWindowSec}s`);
    }

    if (sub === 'banword-add') {
      const word = interaction.options.getString('word', true).trim().toLowerCase();
      automodConfig.banwords.add(word);
      saveSettings();
      return interaction.reply(`✅ Banword ditambahkan: \`${word}\``);
    }

    if (sub === 'banword-remove') {
      const word = interaction.options.getString('word', true).trim().toLowerCase();
      automodConfig.banwords.delete(word);
      saveSettings();
      return interaction.reply(`✅ Banword dihapus: \`${word}\``);
    }

    if (sub === 'banword-list') {
      const words = [...automodConfig.banwords];
      if (!words.length) return interaction.reply('Banword list kosong.');
      return interaction.reply(`Banword list (${words.length}):\n${words.map((w) => `- \`${w}\``).join('\n')}`);
    }
  }
});

(async () => {
  try {
    loadSettings();
    await registerCommands();
    await client.login(token);
  } catch (error) {
    if (String(error && error.message).includes('Used disallowed intents')) {
      console.error('Intent ditolak Discord. Aktifkan Message Content Intent di Discord Developer Portal -> Bot -> Privileged Gateway Intents.');
    } else {
      console.error('Gagal menjalankan bot:', error);
    }
    process.exit(1);
  }
})();
