const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const cors = require('cors');
const { GameDig } = require('gamedig');
const mysql = require('mysql2/promise');
const SteamID = require('steamid'); // Ключевая библиотека для конвертации ID

const app = express();
const PORT = process.env.PORT || 5000;

// ================= НАСТРОЙКИ =================
const STEAM_API_KEY = 'CFD9C7353F93011A7FAC7CD6FBE973E4'; 
const SERVER_IP = '170.168.115.48'; 
const SERVER_PORT = 27115;        

const BACKEND_URL = process.env.BACKEND_URL || `https://shiomi-backend.onrender.com`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://shiomi.onrender.com'; 

const dbConfig = {
    host: '95.213.255.80',
    user: 'u4969_A3VXSIPesr',
    password: 'gyE@hZEu5SS8!94DOqXU+n^3',
    database: 's4969_publuc',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.set('trust proxy', 1); 

app.use(session({
    secret: 'shiomi_secret_key_1337',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, 
        secure: true,                
        sameSite: 'none'            
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
    returnURL: `${BACKEND_URL}/api/auth/steam/return`,
    realm: `${BACKEND_URL}/`,
    apiKey: STEAM_API_KEY
}, (identifier, profile, done) => {
    profile.identifier = identifier;
    return done(null, profile);
}));

// --- ОНЛАЙН СЕРВЕРА ---
let serverCache = { players: 0, maxPlayers: 32 };

async function updateLiveOnline() {
    try {
        const state = await GameDig.query({
            type: 'csgo', 
            host: SERVER_IP,
            port: SERVER_PORT,
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

// ================= МАРШРУТЫ =================

app.get('/api/server/status', (req, res) => res.json(serverCache));

app.get('/api/auth/steam', passport.authenticate('steam'));

app.get('/api/auth/steam/return', passport.authenticate('steam', { failureRedirect: FRONTEND_URL }), (req, res) => {
    res.redirect(FRONTEND_URL);
});

// Основной маршрут профиля с конвертацией ID и поиском в lr_base
app.get('/api/user/profile', async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ error: 'Не авторизован' });

    try {
        // Конвертируем steamId64 в формат STEAM_1:0:12345
        const sid = new SteamID(req.user.id);
        const steamIDFormatted = sid.render(); 

        // Ищем в правильной таблице lr_base по колонке 'steam'
        const [statsRows] = await pool.execute(
            'SELECT value, rank, kills, deaths, headshots FROM lr_base WHERE steam = ? LIMIT 1', 
            [steamIDFormatted]
        );
        const userStats = statsRows[0] || { value: 0, rank: 1, kills: 0, deaths: 0, headshots: 0 };

        // Остальные таблицы проверяем по steamId64, так как там формат другой
        const [vipRows] = await pool.execute('SELECT 1 FROM vip_users WHERE steam_id = ? LIMIT 1', [req.user.id]);
        const [adminRows] = await pool.execute('SELECT 1 FROM admin_users WHERE steam_id = ? LIMIT 1', [req.user.id]);
        const [rouletteRows] = await pool.execute('SELECT last_spin FROM site_users WHERE steam_id = ? LIMIT 1', [req.user.id]);

        res.json({
            username: req.user.displayName,
            avatar: req.user.photos?.[2]?.value || 'https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
            roles: { admin: adminRows.length > 0, vip: vipRows.length > 0 },
            stats: {
                kills: Number(userStats.kills) || 0,
                deaths: Number(userStats.deaths) || 0,
                headshots: Number(userStats.headshots) || 0,
                level: Number(userStats.rank) || 1,
                points: Number(userStats.value) || 0
            },
            lastSpin: rouletteRows[0]?.last_spin || null
        });
    } catch (err) {
        console.error('Ошибка профиля:', err.message);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ... здесь твой код рулетки ...

app.listen(PORT, () => console.log(`[ShioMI] Запущен на порту ${PORT}`));