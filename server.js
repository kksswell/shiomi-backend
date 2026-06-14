const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const cors = require('cors');
const { GameDig } = require('gamedig');

const app = express();
const PORT = process.env.PORT || 5000;

// ================= НАСТРОЙКИ =================
const STEAM_API_KEY = 'CFD9C7353F93011A7FAC7CD6FBE973E4'; 
const SERVER_IP = '170.168.115.48'; // IP твоего сервера CS2 (без порта)
const SERVER_PORT = 27115;        // Порт твоего сервера CS2

// URL твоего бэкенда и фронтенда на Render
const BACKEND_URL = process.env.BACKEND_URL || `https://shiomi-backend.onrender.com`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://shiomi.onrender.com'; 
// ===============================================================

// Настройка CORS (ОБЯЗАТЕЛЬНО credentials: true для передачи кук сессии)
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));

// 🔥 ФИКС: Включаем проксирование, чтобы Express доверял HTTPS-трафику от Render!
// Без этого secure куки на Render просто сбрасывались браузером
app.set('trust proxy', 1); 

// Настройка сессий (cookie изменены для безопасной работы HTTPS кросс-доменно на Render)
app.use(session({
    secret: 'shiomi_secret_key_1337',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // Сессия на 1 день
        secure: true,                // true, так как Render работает на HTTPS
        sameSite: 'none'             // Разрешает передавать куки между разными доменами Render
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Паспорт: сериализация пользователя
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// Настройка стратегии авторизации Steam (ПОДПРАВЛЕНЫ ПУТИ С /api/)
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

// Переменная для хранения актуального статуса сервера
let serverCache = {
    players: 0, // Переименовано в players, так как фронтенд ищет data.players
    maxPlayers: 32
};

// Функция циклического обновления онлайна (раз в 15 секунд)
async function updateLiveOnline() {
    try {
        const state = await GameDig.query({
            type: 'csgo', // Для CS2 используется протокол csgo
            host: SERVER_IP,
            port: SERVER_PORT,
            socketTimeout: 3000
        });
        
        serverCache.players = state.players.length;
        serverCache.maxPlayers = state.maxplayers || 32;
        console.log(`[GameDig] Статус обновлен: ${serverCache.players}/${serverCache.maxPlayers}`);
    } catch (error) {
        console.error('[GameDig] Ошибка подключения к серверу CS2:', error.message);
        serverCache.players = 0;
    }
}

// Запускаем опрос сервера
updateLiveOnline();
setInterval(updateLiveOnline, 15000);

// API Эндпоинт для отдачи онлайна на фронтенд (ПОДПРАВЛЕН ПУТЬ ПОД СТАНДАРТ Скрипта)
app.get('/api/server/status', (req, res) => {
    res.json(req.user ? serverCache : { players: serverCache.players }); // Отдаем онлайн в нужном формате
});

// ================= МАРШРУТЫ АВТОРИЗАЦИИ =================

// 1. Ссылка, куда перенаправляет кнопка "Войти через Steam"
app.get('/api/auth/steam', passport.authenticate('steam'));

// 2. Ссылка возврата от Steam
app.get('/api/auth/steam/return', passport.authenticate('steam', { failureRedirect: FRONTEND_URL }), (req, res) => {
    // При успешном входе редиректим пользователя обратно на фронтенд
    res.redirect(FRONTEND_URL);
});

// 3. API Эндпоинт для проверки фронтендом: авторизован ли текущий пользователь
app.get('/api/user', (req, res) => {
    if (req.isAuthenticated() && req.user) {
        res.json({
            logged: true,
            username: req.user.displayName,
            avatar: req.user.photos && req.user.photos[2] ? req.user.photos[2].value : 'https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg', 
            steamId: req.user.id
        });
    } else {
        res.status(401).json(null); // Если сессии нет — отдаем 401 ошибку, чтобы фронтенд показал кнопку входа
    }
});

// 4. Маршрут для выхода из аккаунта
app.get('/api/auth/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect(FRONTEND_URL);
    });
});

// Запуск бэкенда
app.listen(PORT, () => {
    console.log(`[ShioMI Backend] Сервер успешно запущен на порту ${PORT}`);
    console.log(`[ShioMI Backend] Настройки путей: Backend -> ${BACKEND_URL} | Frontend -> ${FRONTEND_URL}`);
});