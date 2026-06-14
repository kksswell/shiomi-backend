const express = require('express');
const session = require('express-session');
const passport = require('passport');

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Сначала сессии
app.use(session({
    secret: 'shiomi_secret_key_1337',
    resave: false,
    saveUninitialized: false
}));

// 2. ПОСЛЕ сессий — паспорт
app.use(passport.initialize());
app.use(passport.session());

// 3. Маршруты (теперь req.isAuthenticated() будет работать)
app.get('/', (req, res) => {
    res.send('Сервер запущен и Passport готов!');
});

app.listen(PORT, () => {
    console.log(`[ShioMI] Сервер запущен на ${PORT}`);
});