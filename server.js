const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const cors = require('cors');
const Gamedig = require('gamedig'); 
const mysql = require('mysql2/promise');
const SteamID = require('steamid');

const app = express();
const PORT = process.env.PORT || 5000;

// ================= ПОДКЛЮЧЕНИЕ К БД =================
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

// ================= ОНЛАЙН СЕРВЕРА =================
let serverCache = { players: 0, maxPlayers: 32 };

async function updateLiveOnline() {
    try {
        const state = await Gamedig.query({
            type: 'csgo', 
            host: '170.168.115.48',
            port: 27115,
            socketTimeout: 5000
        });
        serverCache.players = state.players.length;
        serverCache.maxPlayers = state.maxplayers || 32;
    } catch (error) {
        console.error('[GameDig] Ошибка опроса:', error.message);
        serverCache.players = 0;
    }
}
// Запускаем опрос при старте и каждые 30 секунд
updateLiveOnline();
setInterval(updateLiveOnline, 30000);

// ================= MIDDLEWARE =================
app.use(cors({ origin: process.env.FRONTEND_URL || 'https://shiomi.onrender.com', credentials: true }));
app.set('trust proxy', 1);

app.use(session({
    secret: 'shiomi_secret_key_1337',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: true, sameSite: 'none' }
}));

app.use(passport.initialize());
app.use(passport.session());

// ================= PASSPORT КОНФИГ =================
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
    returnURL: `${process.env.BACKEND_URL || 'https://shiomi-backend.onrender.com'}/api/auth/steam/return`,
    realm: `${process.env.BACKEND_URL || 'https://shiomi-backend.onrender.com'}/`,
    apiKey: 'CFD9C7353F93011A7FAC7CD6FBE973E4'
}, (identifier, profile, done) => done(null, profile)));

// ================= МАРШРУТЫ =================

app.get('/api/server/status', (req, res) => res.json(serverCache));

app.get('/api/auth/steam', passport.authenticate('steam'));

app.get('/api/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => {
    res.redirect(process.env.FRONTEND_URL || 'https://shiomi.onrender.com');
});

app.get('/api/user/profile', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Не авторизован' });

    try {
        const sid = new SteamID(req.user.id);
        const steamIDFormatted = sid.render(); 

        const [statsRows] = await pool.execute(
            'SELECT value, rank, kills, deaths, headshots FROM lr_base WHERE steam = ? LIMIT 1', 
            [steamIDFormatted]
        );
        
        const userStats = statsRows[0] || { value: 0, rank: 1, kills: 0, deaths: 0, headshots: 0 };

        const [vipRes, adminRes, rouletteRes] = await Promise.all([
            pool.execute('SELECT 1 FROM vip_users WHERE steam_id = ? LIMIT 1', [req.user.id]),
            pool.execute('SELECT 1 FROM admin_users WHERE steam_id = ? LIMIT 1', [req.user.id]),
            pool.execute('SELECT last_spin FROM site_users WHERE steam_id = ? LIMIT 1', [req.user.id])
        ]);

        res.json({
            username: req.user.displayName,
            avatar: req.user.photos?.[2]?.value || 'https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
            roles: { 
                admin: adminRes[0].length > 0, 
                vip: vipRes[0].length > 0 
            },
            stats: {
                kills: Number(userStats.kills) || 0,
                deaths: Number(userStats.deaths) || 0,
                headshots: Number(userStats.headshots) || 0,
                level: Number(userStats.rank) || 1,
                points: Number(userStats.value) || 0
            },
            lastSpin: rouletteRes[0][0]?.last_spin || null
        });
    } catch (err) {
        console.error('Ошибка профиля:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.listen(PORT, () => console.log(`[ShioMI] Сервер запущен на ${PORT}`));