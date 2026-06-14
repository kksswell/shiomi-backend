const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const cors = require('cors');
const { GameDig } = require('gamedig');
const mysql = require('mysql2/promise'); // Пакет для работы с БД серверов

const app = express();
const PORT = process.env.PORT || 5000;

// ================= НАСТРОЙКИ =================
const STEAM_API_KEY = 'CFD9C7353F93011A7FAC7CD6FBE973E4'; 
const SERVER_IP = '170.168.115.48'; 
const SERVER_PORT = 27115;        

const BACKEND_URL = process.env.BACKEND_URL || `https://shiomi-backend.onrender.com`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://shiomi.onrender.com'; 

// 🛑 НАСТРОЙКА ПОДКЛЮЧЕНИЯ К ТВОЕЙ БАЗЕ ДАННЫХ MySQL (Заполни своими данными)
const dbConfig = {
    host: '95.213.255.80',
    user: 'u4969_A3VXSIPesr',
    password: 'gyE@hZEu5SS8!94DOqXU+n^3',
    database: 's4969_publuc',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Создаем пул подключений к БД
const pool = mysql.createPool(dbConfig);
// ===============================================================

app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));

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

passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((obj, done) => {
    done(null, obj);
});

passport.use(new SteamStrategy({
    returnURL: `${BACKEND_URL}/api/auth/steam/return`,
    realm: `${BACKEND_URL}/`,
    apiKey: STEAM_API_KEY
}, (identifier, profile, done) => {
    process.nextTick(() => {
        profile.identifier = identifier;
        return done(null, profile);
    });
}));

// --- ОНЛАЙН СЕРВЕРА ---
let serverCache = { players: 0, maxPlayers: 32 };

async function updateLiveOnline() {
    try {
        const state = await GameDig.query({
            type: 'csgo', 
            host: SERVER_IP,
            port: SERVER_PORT,
            socketTimeout: 3000
        });
        serverCache.players = state.players.length;
        serverCache.maxPlayers = state.maxplayers || 32;
    } catch (error) {
        console.error('[GameDig] Ошибка подключения:', error.message);
        serverCache.players = 0;
    }
}
updateLiveOnline();
setInterval(updateLiveOnline, 15000);

app.get('/api/server/status', (req, res) => {
    res.json(req.user ? serverCache : { players: serverCache.players }); 
});

// ================= МАРШРУТЫ АВТОРИЗАЦИИ =================

app.get('/api/auth/steam', passport.authenticate('steam'));

app.get('/api/auth/steam/return', passport.authenticate('steam', { failureRedirect: FRONTEND_URL }), (req, res) => {
    res.redirect(FRONTEND_URL);
});

// Базовый роут проверки авторизации
app.get('/api/user', (req, res) => {
    if (req.isAuthenticated() && req.user) {
        res.json({
            logged: true,
            username: req.user.displayName,
            avatar: req.user.photos && req.user.photos[2] ? req.user.photos[2].value : 'https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg', 
            steamId: req.user.id
        });
    } else {
        res.status(401).json(null); 
    }
});

// ================= ПОЛНЫЙ ПРОФИЛЬ ИЗ БАЗЫ ДАННЫХ =================
app.get('/api/user/profile', async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const steamId64 = req.user.id; // Пример: 76561198XXXXXXXXX

    try {
        // 1. Ищем ранг/статистику (Пример для Levels Ranks, подправь под свои таблицы)
        const [statsRows] = await pool.execute('SELECT * FROM lr_players WHERE steam_id = ? LIMIT 1', [steamId64]);
        const userStats = statsRows[0] || { value: 0, rank: 1, kills: 0, deaths: 0, shoots: 0, hits: 0, headshots: 0 };

        // 2. Проверяем VIP статус (Таблица vip_users)
        const [vipRows] = await pool.execute('SELECT * FROM vip_users WHERE steam_id = ? LIMIT 1', [steamId64]);
        const isVip = vipRows.length > 0;

        // 3. Проверяем Админку (Таблица или колонка админов)
        const [adminRows] = await pool.execute('SELECT * FROM admin_users WHERE steam_id = ? LIMIT 1', [steamId64]);
        const isAdmin = adminRows.length > 0;

        // 4. Проверяем время последнего кручения рулетки на сайте
        const [rouletteRows] = await pool.execute('SELECT last_spin FROM site_users WHERE steam_id = ? LIMIT 1', [steamId64]);
        let lastSpin = rouletteRows[0] ? rouletteRows[0].last_spin : null;

        res.json({
            username: req.user.displayName,
            avatar: req.user.photos && req.user.photos[2] ? req.user.photos[2].value : 'https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
            steamId: steamId64,
            roles: {
                admin: isAdmin,
                vip: isVip
            },
            stats: {
                kills: userStats.kills || 0,
                deaths: userStats.deaths || 0,
                headshots: userStats.headshots || 0,
                level: userStats.rank || 1,
                points: userStats.value || 0
            },
            lastSpin: lastSpin
        });

    } catch (err) {
        console.error('Ошибка получения данных профиля из БД:', err.message);
        // Отдаем дефолтные структуры, если БД еще не настроена полностью
        res.json({
            username: req.user.displayName,
            avatar: req.user.photos && req.user.photos[2] ? req.user.photos[2].value : '',
            steamId: steamId64,
            roles: { admin: false, vip: false },
            stats: { kills: 0, deaths: 0, headshots: 0, level: 1, points: 0 },
            lastSpin: null
        });
    }
});

// ================= ЕЖЕДНЕВНАЯ РУЛЕТКА (РАЗ В 24 ЧАСА) =================
app.post('/api/roulette/spin', async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: 'Авторизуйтесь перед началом игры!' });
    }

    const steamId64 = req.user.id;
    const now = new Date();

    try {
        // Убедимся, что запись пользователя существует в таблице сайта
        await pool.execute('INSERT IGNORE INTO site_users (steam_id, last_spin) VALUES (?, NULL)', [steamId64]);
        
        // Проверяем время последнего спина
        const [rows] = await pool.execute('SELECT last_spin FROM site_users WHERE steam_id = ?', [steamId64]);
        const lastSpin = rows[0]?.last_spin ? new Date(rows[0].last_spin) : null;

        if (lastSpin && (now - lastSpin < 24 * 60 * 60 * 1000)) {
            const timeLeft = Math.ceil((24 * 60 * 60 * 1000 - (now - lastSpin)) / (1000 * 60 * 60));
            return res.status(403).json({ error: `Рулетка будет доступна через ${timeLeft} ч.` });
        }

        // Логика призов: 70% коины, 25% больше коинов, 5% VIP статус на день
        const randomChance = Math.random() * 100;
        let rewardType = '';
        let rewardAmount = 0;

        if (randomChance < 70) {
            rewardType = 'credits';
            rewardAmount = 50; // Начислим 50 коинов
            // Запрос в твою таблицу валюты (например, плагин Shop или VIP кредиты)
            await pool.execute('UPDATE shop_players SET credits = credits + ? WHERE steam_id = ?', [rewardAmount, steamId64]);
        } else if (randomChance < 95) {
            rewardType = 'credits';
            rewardAmount = 200;
            await pool.execute('UPDATE shop_players SET credits = credits + ? WHERE steam_id = ?', [rewardAmount, steamId64]);
        } else {
            rewardType = 'vip';
            rewardAmount = 1; // 1 день VIP
            // Добавляем запись в плагин VIP (структура зависит от твоего плагина)
            await pool.execute('INSERT INTO vip_users (steam_id, expires) VALUES (?, NOW() + INTERVAL 1 DAY) ON DUPLICATE KEY UPDATE expires = expires + INTERVAL 1 DAY', [steamId64]);
        }

        // Обновляем время прокрутки на сайте
        await pool.execute('UPDATE site_users SET last_spin = ? WHERE steam_id = ?', [now, steamId64]);

        res.json({ success: true, rewardType, rewardAmount });

    } catch (err) {
        console.error('Ошибка в работе рулетки:', err.message);
        res.status(500).json({ error: 'Не удалось запустить рулетку. Проверьте БД.' });
    }
});

app.get('/api/auth/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect(FRONTEND_URL);
    });
});

app.listen(PORT, () => {
    console.log(`[ShioMI Backend] Сервер успешно запущен на порту ${PORT}`);
});