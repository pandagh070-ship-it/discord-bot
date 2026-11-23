# Eto Discord Bot

بوت موسيقى بسيط باستخدام Node.js و discord.js 14.

## الأوامر الحالية
- `/music play song`: تشغيل أغنية محفوظة في مجلد `songs/`.
- `/music play url`: تشغيل ملف صوتي من رابط HTTPS مباشر.
- `/music stop`: إيقاف التشغيل ومغادرة الروم الصوتي.

## تشغيل رابط
استخدم `/music play` ثم ضع الرابط في خيار `url`. يجب أن يكون الرابط رابط ملف صوتي مباشر عبر HTTPS، وليس رابط صفحة YouTube أو TikTok أو Spotify.

## إضافة ملفات محلية
ضع ملفات MP3 أو WAV أو OGG أو FLAC أو M4A داخل مجلد `songs/`، ثم شغّل `npm run register` لتحديث قائمة الأغاني. تظهر حتى 25 أغنية في قائمة Discord.

## الإعداد
أضف `DISCORD_TOKEN` و `CLIENT_ID` إلى متغيرات البيئة. يمكن إضافة `GUILD_ID` لتسجيل الأمر فوراً في سيرفر واحد. امنح البوت صلاحيات View Channel وConnect وSpeak.
