const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const cors = require('cors');
// ВАЖНО: Проверь, какая версия установлена в package.json. 
// Для версий 4+ это стандарт:
const Gamedig = require('gamedig'); 
const mysql = require('mysql2/promise');
const SteamID = require('steamid');

const app = express();
const PORT = process.env.PORT || 5000;

// ... (Настройки остаются прежними)
const dbConfig = { /* ... */ };
const pool = mysql.createPool(dbConfig);

// ... (Настройка сессий и паспорта без изменений)

// --- ИСПРАВЛЕННЫЙ ОНЛАЙН СЕРВЕРА ---
let serverCache = { players: 0, maxPlayers: 32 };

async function updateLiveOnline() {
    try {
        // Убедись, что Gamedig импортирован корректно
        const state = await Gamedig.query({
            type: 'csgo', 
            host: '170.168.115.48',
            port: 27115,
            socketTimeout: 5000
        });
        serverCache.players = state.players.length;
        serverCache.maxPlayers = state.maxplayers || 32;
    } catch (error) {
        console.error('[GameDig] Ошибка:', error.message);
        serverCache.players = 0;
    }
}
updateLiveOnline();
setInterval(updateLiveOnline, 30000);

// --- МАРШРУТЫ ---
app.get('/api/user/profile', async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    try {
        const sid = new SteamID(req.user.id);
        const steamIDFormatted = sid.render(); 

        // Ищем в lr_base
        const [statsRows] = await pool.execute(
            'SELECT value, rank, kills, deaths, headshots FROM lr_base WHERE steam = ? LIMIT 1', 
            [steamIDFormatted]
        );
        
        const userStats = statsRows[0] || { value: 0, rank: 1, kills: 0, deaths: 0, headshots: 0 };

        // Параллельное выполнение запросов для скорости
        const [vipRows, adminRows, rouletteRows] = await Promise.all([
            pool.execute('SELECT 1 FROM vip_users WHERE steam_id = ? LIMIT 1', [req.user.id]),
            pool.execute('SELECT 1 FROM admin_users WHERE steam_id = ? LIMIT 1', [req.user.id]),
            pool.execute('SELECT last_spin FROM site_users WHERE steam_id = ? LIMIT 1', [req.user.id])
        ]);

        res.json({
            username: req.user.displayName,
            avatar: req.user.photos?.[2]?.value || 'https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
            roles: { admin: adminRows[0].length > 0, vip: vipRows[0].length > 0 },
            stats: {
                kills: Number(userStats.kills) || 0,
                deaths: Number(userStats.deaths) || 0,
                headshots: Number(userStats.headshots) || 0,
                level: Number(userStats.rank) || 1,
                points: Number(userStats.value) || 0
            },
            lastSpin: rouletteRows[0][0]?.last_spin || null
        });
    } catch (err) {
        console.error('Ошибка профиля:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.listen(PORT, () => console.log(`[ShioMI] Сервер запущен на ${PORT}`));