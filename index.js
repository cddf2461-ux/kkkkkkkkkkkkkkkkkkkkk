const fs = require('fs');
const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits: P, ChannelType, Events, MessageFlags,
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || '.';
const CATEGORY_ID = process.env.CATEGORY_ID || undefined;
const DATA_FILE = process.env.DATA_FILE || './data.json';
const EPH = MessageFlags.Ephemeral;

if (!TOKEN) { console.error('Defina a variável TOKEN'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// ───────────── MODOS ─────────────
const MODES = {
  amistoso:   { nome: 'Amistoso',        emoji: '🤝', formatos: ['1x1', '2x2', '3x3'], alias: ['amist'] },
  futbrawl:   { nome: 'Futbrawl',        emoji: '⚽', formatos: ['3x3'], alias: ['futebol', 'brawlball', 'bola'] },
  gemas:      { nome: 'Mina de Gemas',   emoji: '💎', formatos: ['3x3'], alias: ['gemgrab', 'mina'] },
  roubo:      { nome: 'Roubo',           emoji: '💰', formatos: ['3x3'], alias: ['heist', 'cofre'] },
  recompensa: { nome: 'Recompensa',      emoji: '⭐', formatos: ['3x3'], alias: ['bounty'] },
  zona:       { nome: 'Zona Estratégica',emoji: '📍', formatos: ['3x3'], alias: ['hotzone', 'zonaestrategica'] },
  nocaute:    { nome: 'Nocaute',         emoji: '🥊', formatos: ['3x3'], alias: ['knockout', 'ko'] },
};
const ALIAS = {};
for (const [k, m] of Object.entries(MODES)) { ALIAS[k] = k; m.alias.forEach((a) => (ALIAS[a] = k)); }

// ───────────── DADOS ─────────────
let db = { stats: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
const save = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch (e) { console.error(e); } };
const stat = (id) => {
  const s = (db.stats[id] ||= {});
  s.w ||= 0; s.l ||= 0; s.mvp ||= 0; s.pts ||= 0; s.streak ||= 0;
  return s;
};

const PTS = { win: 25, loss: 15, mvp: 10 };
const RANKS = [
  { min: 0, nome: 'Bronze', emoji: '🥉' }, { min: 100, nome: 'Prata', emoji: '🥈' },
  { min: 250, nome: 'Ouro', emoji: '🥇' }, { min: 500, nome: 'Platina', emoji: '💠' },
  { min: 900, nome: 'Diamante', emoji: '💎' }, { min: 1400, nome: 'Mestre', emoji: '👑' },
];
const rankOf = (pts) => [...RANKS].reverse().find((r) => pts >= r.min);

// ───────────── ESTADO ─────────────
const queues = new Map();     // id -> fila
const matches = new Map();    // channelId -> partida
const userQueue = new Map();  // userId -> id da fila
const userMatch = new Map();  // userId -> channelId
let seq = 0;

const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const mentions = (ids) => ids.map((i) => `<@${i}>`).join(' ');
const isPlayer = (m, id) => m.teamA.includes(id) || m.teamB.includes(id);
const isStaff = (member) => member?.permissions.has(P.ManageChannels);

// ───────────── EMBEDS ─────────────
function tutorialEmbed() {
  return new EmbedBuilder().setColor(0x5865F2).setTitle('📖 Tutorial — Fila Brawl Stars')
    .addFields(
      { name: '1️⃣ Criar fila', value: '`.amistoso 1x1` `.amistoso 2x2` `.amistoso 3x3`\n`.futbrawl` `.gemas` `.roubo` `.recompensa` `.zona` `.nocaute`\nOu use o `.painel` (menu + botões).' },
      { name: '2️⃣ Entrar / sair', value: 'Botão **Entrar** na fila ou `.sair`.' },
      { name: '3️⃣ Iniciar', value: 'Fila cheia → `.go` ou botão **Iniciar**. Cria um canal privado só com os jogadores e sorteia os times.' },
      { name: '4️⃣ No canal da partida', value: '`.criar CÓDIGO` — envia o código da sala\n`.win A` / `.win B` / `.win @jogador` — informa quem ganhou\nBot pergunta o **MVP** → marque com @ (ou escreva `pular`)\nO time adversário clica em **Confirmar** → sala fecha sozinha.' },
      { name: '📊 Extras', value: '`.fila` filas abertas • `.ranking` • `.perfil [@user]` • `.time [@user]` • `.modos` • `.cancelar` (host da fila / staff na partida) • `.painel` (staff)' },
    );
}
function modosEmbed() {
  return new EmbedBuilder().setColor(0x5865F2).setTitle('🎮 Modos')
    .setDescription(Object.entries(MODES).map(([k, m]) => `${m.emoji} **${m.nome}** — \`${PREFIX}${k}\` — ${m.formatos.join(', ')}`).join('\n'));
}
function rankingEmbed() {
  const top = Object.keys(db.stats).map((id) => [id, stat(id)]).sort((a, b) => b[1].pts - a[1].pts || b[1].w - a[1].w).slice(0, 10);
  return new EmbedBuilder().setColor(0xF5C518).setTitle('🏆 Ranking')
    .setDescription(top.length
      ? top.map(([id, s], i) => `**${i + 1}.** ${rankOf(s.pts).emoji} <@${id}> — **${s.pts} pts** • ${s.w}V ${s.l}D ⭐${s.mvp}`).join('\n')
      : 'Ninguém jogou ainda.');
}
function filasEmbed(guildId) {
  const list = [...queues.values()].filter((q) => q.guildId === guildId);
  return new EmbedBuilder().setColor(0xF5C518).setTitle('📋 Filas abertas')
    .setDescription(list.length
      ? list.map((q) => `${MODES[q.mode].emoji} **${MODES[q.mode].nome} ${q.size}x${q.size}** — ${q.players.length}/${q.size * 2} — [ir para a fila](https://discord.com/channels/${q.guildId}/${q.channelId}/${q.msgId})`).join('\n')
      : 'Nenhuma fila aberta. Crie com `.amistoso 1x1` ou `.painel`.');
}

// ───────────── FILA ─────────────
function queuePayload(q) {
  const total = q.size * 2, cheia = q.players.length >= total, m = MODES[q.mode];
  const embed = new EmbedBuilder().setColor(cheia ? 0x2ECC71 : 0xF5C518)
    .setTitle(`${m.emoji} Fila ${m.nome} ${q.size}x${q.size}`)
    .setDescription(
      `👑 Host: <@${q.host}>\n\n**Jogadores (${q.players.length}/${total})**\n` +
      q.players.map((id, n) => `\`${n + 1}.\` <@${id}>`).join('\n') +
      `\n\n${cheia ? '✅ **Fila cheia!** Use `.go` ou clique em **Iniciar**.' : 'Clique em **Entrar** para participar.'}`)
    .setFooter({ text: `Fila #${q.id}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`q:join:${q.id}`).setLabel('Entrar').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(cheia),
    new ButtonBuilder().setCustomId(`q:leave:${q.id}`).setLabel('Sair').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`q:go:${q.id}`).setLabel('Iniciar').setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(!cheia),
    new ButtonBuilder().setCustomId(`q:cancel:${q.id}`).setLabel('Cancelar').setEmoji('🛑').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}
const qChannel = (q) => client.channels.cache.get(q.channelId);
const atualizarFilaMsg = (q) => qChannel(q)?.messages.edit(q.msgId, queuePayload(q)).catch(() => {});
const fecharFilaMsg = (q, texto) =>
  qChannel(q)?.messages.edit(q.msgId, { embeds: [new EmbedBuilder().setColor(0x95A5A6).setDescription(texto)], components: [] }).catch(() => {});

async function criarFila(channel, user, modeKey, fmt) {
  if (userQueue.has(user.id) || userMatch.has(user.id)) return { erro: 'Você já está em uma fila ou partida. Use `.sair`.' };
  const q = { id: String(++seq), mode: modeKey, size: parseInt(fmt), players: [user.id], host: user.id, channelId: channel.id, guildId: channel.guild.id, msgId: null };
  queues.set(q.id, q); userQueue.set(user.id, q.id);
  try { q.msgId = (await channel.send(queuePayload(q))).id; }
  catch { queues.delete(q.id); userQueue.delete(user.id); return { erro: 'Não consegui enviar mensagem aqui (permissões do bot?).' }; }
  return {};
}
function entrar(q, uid) {
  if (userQueue.has(uid) || userMatch.has(uid)) return 'Você já está em uma fila ou partida.';
  if (q.players.length >= q.size * 2) return 'Fila cheia.';
  q.players.push(uid); userQueue.set(uid, q.id); return null;
}
function sair(q, uid) {
  if (!q.players.includes(uid)) return { err: 'Você não está nesta fila.' };
  q.players = q.players.filter((x) => x !== uid); userQueue.delete(uid);
  if (!q.players.length) { queues.delete(q.id); return { vazia: true }; }
  if (q.host === uid) q.host = q.players[0];
  return {};
}
function cancelarFila(q) { q.players.forEach((u) => userQueue.delete(u)); queues.delete(q.id); }

// ───────────── PARTIDA ─────────────
function matchEmbed(m) {
  const mode = MODES[m.mode];
  return new EmbedBuilder().setColor(0x2ECC71).setTitle(`${mode.emoji} ${mode.nome} ${m.size}x${m.size}`)
    .setDescription('**Como funciona**\n1️⃣ Um jogador manda `.criar CÓDIGO` (ou botão 🔑)\n2️⃣ Joguem a partida\n3️⃣ Ao terminar: `.win A` ou `.win B` (ou botões)\n4️⃣ Marque o MVP e o time adversário confirma')
    .addFields(
      { name: '🔵 Time A', value: mentions(m.teamA), inline: true },
      { name: '🔴 Time B', value: mentions(m.teamB), inline: true },
      { name: '🔑 Código da sala', value: m.codigo ? `# \`${m.codigo}\`` : 'Ainda não criada — use `.criar CÓDIGO`' },
    );
}
const matchButtons = () => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('m:code').setLabel('Informar código').setEmoji('🔑').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('m:wina').setLabel('Vitória Time A').setEmoji('🔵').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('m:winb').setLabel('Vitória Time B').setEmoji('🔴').setStyle(ButtonStyle.Success),
)];

async function iniciar(q, guild) {
  if (q.players.length < q.size * 2) return 'A fila ainda não está cheia.';
  if (q.starting) return 'Já estou criando a partida...';
  q.starting = true;
  const ids = shuffle(q.players);
  const teamA = ids.slice(0, q.size), teamB = ids.slice(q.size);
  let ch;
  try {
    ch = await guild.channels.create({
      name: `${q.mode}-${q.size}x${q.size}-${q.id}`,
      type: ChannelType.GuildText,
      parent: CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageChannels] },
        ...ids.map((id) => ({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })),
      ],
    });
  } catch (e) {
    console.error(e); q.starting = false;
    return 'Não consegui criar o canal. Dê a permissão **Gerenciar Canais** ao bot.';
  }
  queues.delete(q.id); ids.forEach((u) => userQueue.delete(u));
  const m = { mode: q.mode, size: q.size, teamA, teamB, codigo: null, report: null, msgId: null, timer: null };
  matches.set(ch.id, m); ids.forEach((u) => userMatch.set(u, ch.id));
  m.timer = setTimeout(() => closeMatch(ch, 0), 3 * 60 * 60 * 1000); // fecha sozinho após 3h
  m.msgId = (await ch.send({ content: mentions(ids), embeds: [matchEmbed(m)], components: matchButtons() })).id;
  await fecharFilaMsg(q, `✅ Partida iniciada em ${ch}`);
  qChannel(q)?.send(`✅ Partida criada: ${ch} — ${mentions(ids)}`).catch(() => {});
  return null;
}

function closeMatch(channel, delay = 0) {
  const m = matches.get(channel.id);
  if (m) { clearTimeout(m.timer); [...m.teamA, ...m.teamB].forEach((u) => userMatch.delete(u)); matches.delete(channel.id); }
  setTimeout(() => channel.delete().catch(() => {}), delay);
}

async function setCodigo(channel, user, codigo) {
  const m = matches.get(channel.id);
  if (!m) return 'Use este comando dentro do canal da partida.';
  if (!isPlayer(m, user.id)) return 'Você não está nesta partida.';
  codigo = (codigo || '').toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(codigo)) return 'Código inválido. Ex.: `.criar ABC123`';
  m.codigo = codigo;
  await channel.messages.edit(m.msgId, { embeds: [matchEmbed(m)], components: matchButtons() }).catch(() => {});
  await channel.send({
    content: mentions([...m.teamA, ...m.teamB]),
    embeds: [new EmbedBuilder().setColor(0x3498DB).setTitle('🔑 Sala criada!')
      .setDescription(`# \`${codigo}\`\nCriada por <@${user.id}>. Entrem na sala pelo código dentro do Brawl Stars.`)],
  });
  return null;
}

async function iniciarReport(channel, userId, team) {
  const m = matches.get(channel.id);
  if (!m) return 'Use dentro do canal da partida.';
  if (!isPlayer(m, userId)) return 'Você não está nesta partida.';
  if (m.report) return 'Já existe um resultado em andamento. Aguarde a confirmação.';
  m.report = { team, by: userId, stage: 'mvp' };
  await channel.send(`🏆 <@${userId}> informou vitória do **${team === 'A' ? '🔵 Time A' : '🔴 Time B'}**.\n⭐ Quem foi o **MVP**? Marque com @ (do time vencedor) ou escreva \`pular\`.`);
  return null;
}

async function pedirConfirmacao(channel, m, mvp) {
  const r = m.report;
  r.stage = 'confirm'; r.mvp = mvp;
  const reporterTeam = m.teamA.includes(r.by) ? 'A' : 'B';
  r.confirmTeam = reporterTeam === 'A' ? 'B' : 'A';
  const confirmIds = r.confirmTeam === 'A' ? m.teamA : m.teamB;
  const embed = new EmbedBuilder().setColor(0xF39C12).setTitle('⚠️ Confirmação de resultado')
    .setDescription(`Vencedor: **${r.team === 'A' ? '🔵 Time A' : '🔴 Time B'}**\nMVP: ${mvp ? `<@${mvp}>` : '—'}\nReportado por: <@${r.by}>\n\nO **time adversário** deve confirmar:`);
  await channel.send({
    content: mentions(confirmIds), embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('m:ok').setLabel('Confirmar').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('m:no').setLabel('Contestar').setEmoji('❌').setStyle(ButtonStyle.Danger),
    )],
  });
}

function statusDe(id) {
  const ch = userMatch.get(id), m = ch && matches.get(ch);
  if (m) {
    const t = m.teamA.includes(id) ? 'A' : 'B';
    const aliados = (t === 'A' ? m.teamA : m.teamB).filter((x) => x !== id);
    const adv = t === 'A' ? m.teamB : m.teamA;
    return `${t === 'A' ? '🔵 Time A' : '🔴 Time B'} em <#${ch}>\n👥 Aliados: ${mentions(aliados) || '—'}\n⚔️ Adversários: ${mentions(adv)}`;
  }
  const q = queues.get(userQueue.get(id));
  if (q) return `⏳ Na fila ${MODES[q.mode].nome} ${q.size}x${q.size} (${q.players.length}/${q.size * 2})`;
  return '💤 Fora de fila';
}

async function finalizar(channel, m) {
  const r = m.report;
  const win = r.team === 'A' ? m.teamA : m.teamB, lose = r.team === 'A' ? m.teamB : m.teamA;
  const delta = {};
  win.forEach((i) => { const s = stat(i); s.w++; s.streak = Math.max(s.streak, 0) + 1; s.pts += PTS.win; delta[i] = PTS.win; });
  lose.forEach((i) => { const s = stat(i); s.l++; s.streak = Math.min(s.streak, 0) - 1; const d = Math.min(s.pts, PTS.loss); s.pts -= d; delta[i] = -d; });
  if (r.mvp) { stat(r.mvp).mvp++; stat(r.mvp).pts += PTS.mvp; delta[r.mvp] += PTS.mvp; }
  save();
  const linha = (i) => `<@${i}> ${delta[i] >= 0 ? '+' : ''}${delta[i]} → ${rankOf(stat(i).pts).emoji} ${stat(i).pts}`;
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x2ECC71).setTitle('✅ Partida finalizada')
    .addFields(
      { name: '🏆 Vencedores', value: win.map(linha).join('\n'), inline: true },
      { name: '💀 Perdedores', value: lose.map(linha).join('\n'), inline: true },
      { name: '⭐ MVP', value: r.mvp ? `<@${r.mvp}> (+${PTS.mvp})` : '—' })
    .setFooter({ text: 'Este canal será fechado em 10 segundos.' })] });
  closeMatch(channel, 10000);
}

// ───────────── PAINEL ─────────────
function painelPayload() {
  const options = [];
  for (const [k, m] of Object.entries(MODES)) for (const f of m.formatos) options.push({ label: `${m.nome} ${f}`, value: `${k}:${f}`, emoji: { name: m.emoji } });
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎮 Painel de Filas — Brawl Stars')
    .setDescription('Escolha o **modo e formato** no menu abaixo para criar uma fila.\nTambém funciona por comando: `.amistoso 1x1`, `.futbrawl`, `.tutorial`...');
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('p:select').setPlaceholder('Escolha o modo e o formato').addOptions(options)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('p:filas').setLabel('Filas abertas').setEmoji('📋').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('p:rank').setLabel('Ranking').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('p:tutorial').setLabel('Tutorial').setEmoji('📖').setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

// ───────────── COMANDOS ─────────────
client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;

    // resposta do MVP
    const match = matches.get(msg.channelId);
    if (match?.report?.stage === 'mvp' && msg.author.id === match.report.by && !msg.content.startsWith(PREFIX)) {
      const win = match.report.team === 'A' ? match.teamA : match.teamB;
      if (/^(pular|ninguem|ninguém)$/i.test(msg.content.trim())) return pedirConfirmacao(msg.channel, match, null);
      const u = msg.mentions.users.first();
      if (!u) return;
      if (!win.includes(u.id)) return void msg.reply('O MVP precisa ser do **time vencedor**.');
      return pedirConfirmacao(msg.channel, match, u.id);
    }

    if (!msg.content.startsWith(PREFIX)) return;
    const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (args.shift() || '').toLowerCase();
    const uid = msg.author.id;
    const qid = userQueue.get(uid), q = qid && queues.get(qid);

    // criar fila por modo
    if (ALIAS[cmd]) {
      const key = ALIAS[cmd], m = MODES[key];
      const fmt = args[0] ? args[0].toLowerCase().replace('×', 'x') : m.formatos[m.formatos.length - 1];
      if (!m.formatos.includes(fmt)) return void msg.reply(`Formato inválido. Use: ${m.formatos.map((f) => `\`${PREFIX}${key} ${f}\``).join(', ')}`);
      const r = await criarFila(msg.channel, msg.author, key, fmt);
      return void (r.erro && msg.reply(r.erro));
    }

    switch (cmd) {
      case 'tutorial': case 'ajuda': case 'help':
        return void msg.channel.send({ embeds: [tutorialEmbed()] });
      case 'modos':
        return void msg.channel.send({ embeds: [modosEmbed()] });
      case 'ranking': case 'rank':
        return void msg.channel.send({ embeds: [rankingEmbed()] });
      case 'fila': case 'filas':
        return void msg.channel.send({ embeds: [filasEmbed(msg.guild.id)] });
      case 'perfil': {
        const u = msg.mentions.users.first() || msg.author, s = stat(u.id), r = rankOf(s.pts), jogos = s.w + s.l;
        return void msg.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${r.emoji} ${u.username} — ${r.nome}`)
          .setDescription(`📈 Pontos: **${s.pts}**\n🏆 ${s.w}V • 💀 ${s.l}D • ⭐ ${s.mvp} MVP\n🎯 Winrate: **${jogos ? Math.round((s.w / jogos) * 100) : 0}%**\n🔥 Sequência: **${s.streak > 0 ? s.streak + 'V' : s.streak < 0 ? Math.abs(s.streak) + 'D' : '—'}**`)
          .addFields({ name: '📍 Agora', value: statusDe(u.id) })] });
      }
      case 'time': {
        const u = msg.mentions.users.first() || msg.author;
        return void msg.reply(statusDe(u.id));
      }
      case 'painel':
        if (!msg.member.permissions.has(P.ManageMessages)) return void msg.reply('Só staff pode postar o painel.');
        return void msg.channel.send(painelPayload());
      case 'go': {
        if (!q) return void msg.reply('Você não está em nenhuma fila.');
        const err = await iniciar(q, msg.guild);
        return void (err && msg.reply(err));
      }
      case 'sair': {
        if (!q) return void msg.reply('Você não está em nenhuma fila.');
        const r = sair(q, uid);
        if (r.vazia) await fecharFilaMsg(q, '❌ Fila encerrada (vazia).'); else await atualizarFilaMsg(q);
        return void msg.reply('👋 Você saiu da fila.');
      }
      case 'cancelar': {
        if (match) {
          if (!isStaff(msg.member)) return void msg.reply('Só staff pode cancelar uma partida em andamento.');
          await msg.channel.send('🛑 Partida cancelada. Fechando o canal...');
          return closeMatch(msg.channel, 5000);
        }
        if (!q) return void msg.reply('Você não está em nenhuma fila.');
        if (q.host !== uid && !isStaff(msg.member)) return void msg.reply('Só o host pode cancelar a fila.');
        cancelarFila(q); await fecharFilaMsg(q, '🛑 Fila cancelada.');
        return void msg.reply('🛑 Fila cancelada.');
      }
      case 'criar': {
        const err = await setCodigo(msg.channel, msg.author, args[0]);
        return void (err && msg.reply(err));
      }
      case 'win': {
        const a = (args[0] || '').toLowerCase();
        let team = null;
        if (['a', '1', 'timea'].includes(a)) team = 'A';
        else if (['b', '2', 'timeb'].includes(a)) team = 'B';
        else if (match) {
          const u = msg.mentions.users.first();
          if (u) team = match.teamA.includes(u.id) ? 'A' : match.teamB.includes(u.id) ? 'B' : null;
        }
        if (!team) return void msg.reply('Use `.win A`, `.win B` ou `.win @jogador`.');
        const err = await iniciarReport(msg.channel, uid, team);
        return void (err && msg.reply(err));
      }
    }
  } catch (e) { console.error(e); }
});

// ───────────── BOTÕES / MENUS / MODAL ─────────────
function codeModal() {
  return new ModalBuilder().setCustomId('m:codeSubmit').setTitle('Código da sala').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('codigo').setLabel('Código da sala do Brawl Stars')
        .setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(12).setRequired(true)));
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isButton()) {
      const [k, a, id] = i.customId.split(':');

      if (k === 'p') {
        if (a === 'filas') return i.reply({ embeds: [filasEmbed(i.guildId)], flags: EPH });
        if (a === 'rank') return i.reply({ embeds: [rankingEmbed()], flags: EPH });
        if (a === 'tutorial') return i.reply({ embeds: [tutorialEmbed()], flags: EPH });
      }

      if (k === 'q') {
        const q = queues.get(id);
        if (!q) return i.reply({ content: 'Esta fila não existe mais.', flags: EPH });
        if (a === 'join') {
          const err = entrar(q, i.user.id);
          if (err) return i.reply({ content: err, flags: EPH });
          await i.update(queuePayload(q));
          if (q.players.length >= q.size * 2) i.channel.send(`✅ Fila cheia! ${mentions(q.players)} — use **.go** ou o botão **Iniciar**.`).catch(() => {});
          return;
        }
        if (a === 'leave') {
          const r = sair(q, i.user.id);
          if (r.err) return i.reply({ content: r.err, flags: EPH });
          if (r.vazia) return i.update({ embeds: [new EmbedBuilder().setColor(0x95A5A6).setDescription('❌ Fila encerrada (vazia).')], components: [] });
          return i.update(queuePayload(q));
        }
        if (a === 'go') {
          if (!q.players.includes(i.user.id)) return i.reply({ content: 'Só quem está na fila pode iniciar.', flags: EPH });
          await i.deferUpdate();
          const err = await iniciar(q, i.guild);
          return void (err && i.followUp({ content: err, flags: EPH }));
        }
        if (a === 'cancel') {
          if (q.host !== i.user.id && !isStaff(i.member)) return i.reply({ content: 'Só o host pode cancelar.', flags: EPH });
          cancelarFila(q);
          return i.update({ embeds: [new EmbedBuilder().setColor(0x95A5A6).setDescription('🛑 Fila cancelada.')], components: [] });
        }
      }

      if (k === 'm') {
        const m = matches.get(i.channelId);
        if (!m) return i.reply({ content: 'Partida não encontrada.', flags: EPH });
        if (a === 'code') {
          if (!isPlayer(m, i.user.id)) return i.reply({ content: 'Você não está nesta partida.', flags: EPH });
          return i.showModal(codeModal());
        }
        if (a === 'wina' || a === 'winb') {
          const err = await iniciarReport(i.channel, i.user.id, a === 'wina' ? 'A' : 'B');
          return err ? i.reply({ content: err, flags: EPH }) : i.deferUpdate();
        }
        if (a === 'ok' || a === 'no') {
          const r = m.report;
          if (!r || r.stage !== 'confirm') return i.reply({ content: 'Nada para confirmar.', flags: EPH });
          const confirmIds = r.confirmTeam === 'A' ? m.teamA : m.teamB;
          if (!confirmIds.includes(i.user.id)) return i.reply({ content: 'Só o time adversário pode responder.', flags: EPH });
          if (a === 'ok') { r.stage = 'done'; await i.update({ components: [] }); return finalizar(i.channel, m); }
          m.report = null;
          await i.update({ components: [] });
          return void i.channel.send('❌ Resultado **contestado**. Reportem de novo com `.win A/B` ou chamem um staff (`.cancelar`).');
        }
      }
    }

    if (i.isStringSelectMenu() && i.customId === 'p:select') {
      const [key, fmt] = i.values[0].split(':');
      const r = await criarFila(i.channel, i.user, key, fmt);
      return i.reply({ content: r.erro || '✅ Fila criada!', flags: EPH });
    }

    if (i.isModalSubmit() && i.customId === 'm:codeSubmit') {
      const err = await setCodigo(i.channel, i.user, i.fields.getTextInputValue('codigo'));
      return i.reply({ content: err || '✅ Código enviado!', flags: EPH });
    }
  } catch (e) { console.error(e); }
});

client.on(Events.ChannelDelete, (ch) => { if (matches.has(ch.id)) closeMatch(ch, 0); });
client.once(Events.ClientReady, (c) => console.log(`✅ Bot online como ${c.user.tag}`));
process.on('unhandledRejection', (e) => console.error(e));
client.login(TOKEN);
