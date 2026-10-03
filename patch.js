const fs = require('fs');

const file = 'index.js';
let s = fs.readFileSync(file, 'utf8');

const helper = `
function hasPermission(interaction, permission) {
    return interaction.memberPermissions?.has(permission) ?? false;
}

function getInvokerMember(interaction) {
    return interaction.guild?.members.cache.get(interaction.user.id) || null;
}

function hasHighRoleForDm(interaction) {
    if (hasPermission(interaction, PermissionsBitField.Flags.Administrator)) return true;
    const invoker = getInvokerMember(interaction);
    const botMember = interaction.guild?.members.me;
    if (!invoker || !botMember) return false;
    return invoker.roles.highest.position > botMember.roles.highest.position;
}
`;

if (!s.includes('function hasPermission(interaction, permission)')) {
    s = s.replace('const SONG_FILE =\n', helper + '\nconst SONG_FILE =\n');
}

s = s.replaceAll('interaction.member.permissions.has(', 'hasPermission(interaction, ');
s = s.replaceAll("client.once('ready', async () => {", "client.once('clientReady', async () => {");
s = s.replaceAll('const member = interaction.member;', 'const member = getInvokerMember(interaction);');
s = s.replaceAll(
`const hasHighRole =
            hasPermission(interaction, PermissionsBitField.Flags.Administrator) ||
            interaction.member.roles.highest.position >=
            interaction.guild.members.me.roles.highest.position;`,
'const hasHighRole = hasHighRoleForDm(interaction);'
);
s = s.replaceAll(
"const member = interaction.options.getMember('user') || interaction.member;",
"const member = interaction.options.getMember('user') || getInvokerMember(interaction);"
);

fs.writeFileSync(file, s, 'utf8');
console.log('Discord interaction compatibility patch applied.');
