const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Настройка сессии
app.use(session({
    secret: 'super_secret_key',
    resave: false,
    saveUninitialized: false
}));

// 2. Инициализация Passport
app.use(passport.initialize());
app.use(passport.session());

// 3. Стратегия (пока заглушка для проверки)
passport.use(new SteamStrategy({
    returnURL: 'http://localhost:5000/api/auth/steam/return', // Поменяй на свой URL в продакшене
    realm: 'http://localhost:5000/',
    apiKey: 'CFD9C7353F93011A7FAC7CD6FBE973E4'
}, (identifier, profile, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// 4. Маршруты
app.get('/api/auth/steam', passport.authenticate('steam'));

app.get('/api/auth/steam/return', 
    passport.authenticate('steam', { failureRedirect: '/' }),
    (req, res) => {
        res.send('Авторизация успешна! Пользователь: ' + req.user.displayName);
    }
);

app.get('/api/me', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ loggedIn: true, user: req.user });
    } else {
        res.json({ loggedIn: false });
    }
});

app.listen(PORT, () => {
    console.log(`[ShioMI] Сервер запущен на ${PORT}`);
});