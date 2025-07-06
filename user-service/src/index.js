require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));
app.use(passport.initialize());

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
});

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await prisma.user.findUnique({ where: { discordId: profile.id } });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    discordId: profile.id,
                    email: profile.email,
                    discordUsername: profile.username,
                    role: 'USER'
                }
            });
        } else {
            // Update discordUsername if it changed
            user = await prisma.user.update({
                where: { id: user.id },
                data: { discordUsername: profile.username }
            });
        }

        return done(null, user);
    } catch (error) {
        return done(error, null);
    }
}));

app.get('/api/auth/discord', passport.authenticate('discord'));

app.get('/api/auth/discord/callback', passport.authenticate('discord', { failureRedirect: 'http://localhost:8080/login-error' }), (req, res) => {
    const token = jwt.sign({ userId: req.user.id }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.redirect(`http://localhost:8080/auth/discord/callback?token=${token}`);
});

const authenticateJWT = (req, res, next) => {
    const userId = req.headers['x-user-id'];

    if (userId) {
        req.user = { userId };
        next();
    } else {
        res.status(401).send('User ID is missing from header.');
    }
};

app.get('/api/users/me', authenticateJWT, async (req, res) => {
    res.set('Cache-Control', 'no-store'); // Always return fresh data
    console.log("/api/users/me endpoint hit");
    console.log("User ID from token:", req.user.userId);
    const user = await prisma.user.findUnique({ 
        where: { id: req.user.userId },
        select: {
            id: true,
            email: true,
            discordId: true,
            discordUsername: true,
            createdAt: true,
            updatedAt: true,
            role: true,
        }
    });
    console.log("User found in DB:", user);
    res.json(user);
});

app.put('/api/users/me', authenticateJWT, async (req, res) => {
    const { email } = req.body;
    const updatedUser = await prisma.user.update({
        where: { id: req.user.userId },
        data: { email }
    });
    res.json(updatedUser);
});

// Batch fetch users by userIds (for admin order page)
app.post('/api/users/batch', async (req, res) => {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array' });
    }
    try {
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
                id: true,
                discordId: true,
                discordUsername: true,
            }
        });
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

const PORT = process.env.PORT || 3001;

let server;

if (require.main === module) {
    server = app.listen(PORT, () => {
        console.log(`User service listening on port ${PORT}`);
    });
}

module.exports = { app, server };
