const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаем статические файлы
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.sqlite');
const GRID_SIZE = 500;

// Хранилище для глобального кулдауна
const userCooldowns = new Map();

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS pixels (
        x INTEGER,
        y INTEGER,
        color TEXT,
        last_updated INTEGER,
        user_id TEXT,
        PRIMARY KEY (x, y)
    )`, (err) => {
        if (err) {
            console.error('Ошибка:', err);
        } else {
            console.log('✅ Таблица готова');
            
            db.get("SELECT COUNT(*) as count FROM pixels", (err, row) => {
                if (err) {
                    console.error('Ошибка:', err);
                    return;
                }
                
                if (row.count === 0) {
                    console.log(`📦 Заполняем поле ${GRID_SIZE}x${GRID_SIZE} белыми пикселями...`);
                    
                    db.run("BEGIN TRANSACTION");
                    const stmt = db.prepare("INSERT OR REPLACE INTO pixels (x, y, color, last_updated, user_id) VALUES (?, ?, '#FFFFFF', ?, 'system')");
                    
                    for (let x = 0; x < GRID_SIZE; x++) {
                        for (let y = 0; y < GRID_SIZE; y++) {
                            stmt.run(x, y, Date.now());
                        }
                        if (x % 100 === 0) {
                            console.log(`   Прогресс: ${x}/${GRID_SIZE}`);
                        }
                    }
                    
                    stmt.finalize(() => {
                        db.run("COMMIT", () => {
                            console.log(`✅ Поле ${GRID_SIZE}x${GRID_SIZE} готово!`);
                        });
                    });
                } else {
                    console.log(`✅ База уже содержит ${row.count} пикселей`);
                }
            });
        }
    });
});

function getPixelRegion(minX, maxX, minY, maxY, callback) {
    minX = Math.max(0, Math.min(GRID_SIZE - 1, minX));
    maxX = Math.max(0, Math.min(GRID_SIZE - 1, maxX));
    minY = Math.max(0, Math.min(GRID_SIZE - 1, minY));
    maxY = Math.max(0, Math.min(GRID_SIZE - 1, maxY));
    
    db.all(
        "SELECT x, y, color FROM pixels WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?",
        [minX, maxX, minY, maxY],
        (err, rows) => {
            callback(rows || []);
        }
    );
}

function updatePixel(x, y, color, userId, callback) {
    const now = Date.now();
    
    if (userCooldowns.has(userId)) {
        const lastPlaceTime = userCooldowns.get(userId);
        const timePassed = now - lastPlaceTime;
        
        if (timePassed < 15000) {
            const waitTime = Math.ceil((15000 - timePassed) / 1000);
            callback({ success: false, error: `Подожди ${waitTime} сек` });
            return;
        }
    }
    
    db.run(
        "INSERT OR REPLACE INTO pixels (x, y, color, last_updated, user_id) VALUES (?, ?, ?, ?, ?)",
        [x, y, color, now, userId],
        function(err) {
            if (err) {
                callback({ success: false, error: 'Ошибка сохранения' });
            } else {
                userCooldowns.set(userId, now);
                callback({ success: true });
                io.emit('pixel_update', { x, y, color });
                
                setTimeout(() => {
                    if (userCooldowns.get(userId) === now) {
                        userCooldowns.delete(userId);
                    }
                }, 15000);
            }
        }
    );
}

let onlinePlayers = 0;

io.on('connection', (socket) => {
    onlinePlayers++;
    io.emit('online_count', onlinePlayers);
    console.log(`👥 Онлайн: ${onlinePlayers}`);
    
    socket.on('request_region', (data) => {
        getPixelRegion(data.minX, data.maxX, data.minY, data.maxY, (pixels) => {
            socket.emit('region_update', { pixels });
        });
    });
    
    socket.on('place_pixel', (data, callback) => {
        const { x, y, color } = data;
        if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
            updatePixel(x, y, color, socket.id, callback);
        } else {
            callback({ success: false, error: `Координаты 0-${GRID_SIZE-1}` });
        }
    });
    
    socket.on('disconnect', () => {
        onlinePlayers--;
        io.emit('online_count', onlinePlayers);
        userCooldowns.delete(socket.id);
        console.log(`👥 Онлайн: ${onlinePlayers}`);
    });
});

// ========== ВАЖНО: правильный запуск сервера ==========
const PORT = process.env.PORT || 10000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ═══════════════════════════════════
    🎨 PIXEL BATTLE ЗАПУЩЕН!
    🌐 Порт: ${PORT}
    🌐 Адрес: http://0.0.0.0:${PORT}
    📐 Поле: ${GRID_SIZE}x${GRID_SIZE}
    ⏱️  Кулдаун: 15 секунд
    ═══════════════════════════════════
    `);
});

server.on('error', (error) => {
    console.error('❌ Ошибка сервера:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Порт ${PORT} уже используется`);
    }
    process.exit(1);
});