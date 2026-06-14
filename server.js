const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const cors = require('cors');
const { GameDig } = require('gamedig');

const app = express();
const PORT = process.env.PORT || 5000;

// ================= НАСТРОЙКИ (ИЗМЕНИ ПОД СЕБЯ) =================
const STEAM_API_KEY = 'CFD9C7353F93011A7FAC7CD6FBE973E4'; 
const SERVER_IP = '170.168.115.48'; // IP твоего сервера CS2 (без порта)
const SERVER_PORT = 27115;        // Порт твоего сервера CS2

// URL твоего бэкенда (на хостинге поменяешь на адрес хостинга, например: https://api.shiomi.ru)
const BACKEND_URL = process.env.BACKEND_URL || `https://shiomi-backend.onrender.com`;
// URL твоего фронтенда (где лежит сайт index.html)
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://shiomi.onrender.com'; 
// ===============================================================

// Настройка CORS, чтобы фронтенд мог общаться с бэкендом
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));

// Настройка сессий для сохранения авторизации игрока
app.use(session({
    secret: 'shiomi_secret_key_1337',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // Сессия на 1 день
        secure: false // Поставь true, если сайт будет работать на https
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

// Настройка стратегии авторизации Steam
passport.use(new SteamStrategy({
    returnURL: `${BACKEND_URL}/auth/steam/return`,
    realm: BACKEND_URL,
    apiKey: STEAM_API_KEY
}, (identifier, profile, done) => {
    process.nextTick(() => {
        profile.identifier = identifier;
        return done(null, profile);
    });
}));

// Переменная для хранения актуального статуса сервера
let serverCache = {
    online: 0,
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
        
        serverCache.online = state.players.length;
        serverCache.maxPlayers = state.maxplayers || 32;
        console.log(`[GameDig] Статус обновлен: ${serverCache.online}/${serverCache.maxPlayers}`);
    } catch (error) {
        console.error('[GameDig] Ошибка подключения к серверу CS2:', error.message);
        // В случае ошибки оставляем старые данные или сбрасываем в 0
        serverCache.online = 0;
    }
}

// Запускаем опрос сервера
updateLiveOnline();
setInterval(updateLiveOnline, 15000);

// API Эндпоинт для отдачи онлайна на фронтенд
app.get('/api/server-stats', (req, res) => {
    res.json(serverCache);
});

// Маршруты для авторизации через Steam
app.get('/auth/steam', passport.authenticate('steam'));

app.get('/auth/steam/return', passport.authenticate('steam', { failureRedirect: '/' }), (req, res) => {
    // При успешном входе редирекми пользователя обратно на фронтенд
    res.redirect(FRONTEND_URL);
});

// API Эндпоинт для проверки: авторизован ли текущий пользователь
app.get('/api/user', (req, res) => {
    if (req.isAuthenticated() && req.user) {
        res.json({
            logged: true,
            username: req.user.displayName,
            avatar: req.user.photos[2].value, // Большая аватарка из Steam
            steamId: req.user.id
        });
    } else {
        res.json({ logged: false });
    }
});

// Маршрут для выхода из аккаунта
app.get('/auth/logout', (req, res, next) => {
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