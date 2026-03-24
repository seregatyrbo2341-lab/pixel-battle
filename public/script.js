const socket = io();

const canvas = document.getElementById('pixelCanvas');
const ctx = canvas.getContext('2d');
const cooldownSpan = document.getElementById('cooldown');
const coordinatesSpan = document.getElementById('coordinates');
const customColorPicker = document.getElementById('customColor');

const GRID_SIZE = 500;
const VIEW_SIZE = 600;

// Палитра цветов
const PRESET_COLORS = [
    '#FF0000', '#FF4500', '#FFA500', '#FFD700',
    '#FFFF00', '#ADFF2F', '#00FF00', '#00FA9A',
    '#00FFFF', '#1E90FF', '#0000FF', '#8A2BE2',
    '#FF00FF', '#FF1493', '#FF69B4', '#FFFFFF',
    '#D3D3D3', '#808080', '#000000', '#8B4513',
    '#FDD7A4'
];

let currentColor = '#FF0000';
let pixelCache = new Map();
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// Кулдаун
let cooldownTimer = null;
let cooldownEndTime = 0;

canvas.width = VIEW_SIZE;
canvas.height = VIEW_SIZE;

// Создание палитры
function createPalette() {
    const container = document.getElementById('colorPalette');
    container.innerHTML = '';
    
    PRESET_COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            currentColor = color;
            customColorPicker.value = color;
        });
        container.appendChild(swatch);
    });
    
    // Активируем первый цвет
    if (container.firstChild) {
        container.firstChild.classList.add('active');
    }
}

customColorPicker.addEventListener('change', (e) => {
    currentColor = e.target.value;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
});

// Обновление отображения кулдауна
function updateCooldownDisplay() {
    const now = Date.now();
    const remaining = cooldownEndTime - now;
    
    if (remaining > 0) {
        const seconds = Math.ceil(remaining / 1000);
        cooldownSpan.textContent = `⏳ Жди ${seconds} сек`;
        cooldownSpan.style.background = '#ffc107';
        cooldownSpan.style.color = '#000';
        
        cooldownTimer = setTimeout(updateCooldownDisplay, 200);
    } else {
        cooldownSpan.textContent = '✅ Готов';
        cooldownSpan.style.background = '#d4edda';
        cooldownSpan.style.color = '#155724';
        cooldownTimer = null;
    }
}

// Отрисовка
function draw() {
    ctx.fillStyle = '#2c2c2c';
    ctx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    
    for (let [key, color] of pixelCache) {
        let [x, y] = key.split(',').map(Number);
        const screenX = (x * scale) + offsetX;
        const screenY = (y * scale) + offsetY;
        const size = Math.max(1, Math.ceil(scale));
        
        if (screenX + size > 0 && screenX < VIEW_SIZE && screenY + size > 0 && screenY < VIEW_SIZE) {
            ctx.fillStyle = color;
            ctx.fillRect(screenX, screenY, size, size);
        }
    }
}

function getPixelFromScreen(screenX, screenY) {
    const worldX = (screenX - offsetX) / scale;
    const worldY = (screenY - offsetY) / scale;
    return { x: Math.floor(worldX), y: Math.floor(worldY) };
}

// Клик по холсту
canvas.addEventListener('click', (e) => {
    if (isDragging) return;
    
    // Проверка кулдауна
    if (cooldownTimer !== null) {
        cooldownSpan.textContent = '⏳ Подожди!';
        cooldownSpan.style.background = '#f8d7da';
        cooldownSpan.style.color = '#721c24';
        setTimeout(() => {
            if (cooldownTimer !== null) {
                updateCooldownDisplay();
            }
        }, 1000);
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const screenX = (e.clientX - rect.left) * scaleX;
    const screenY = (e.clientY - rect.top) * scaleY;
    const { x, y } = getPixelFromScreen(screenX, screenY);
    
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
        cooldownSpan.textContent = '⏳ Отправка...';
        cooldownSpan.style.background = '#fff3cd';
        cooldownSpan.style.color = '#856404';
        
        socket.emit('place_pixel', { x, y, color: currentColor }, (response) => {
            if (response.success) {
                cooldownEndTime = Date.now() + 15000;
                updateCooldownDisplay();
                pixelCache.set(`${x},${y}`, currentColor);
                draw();
            } else {
                cooldownSpan.textContent = `❌ ${response.error}`;
                cooldownSpan.style.background = '#f8d7da';
                cooldownSpan.style.color = '#721c24';
                setTimeout(() => {
                    if (cooldownSpan.textContent.includes('❌')) {
                        cooldownSpan.textContent = '✅ Готов';
                        cooldownSpan.style.background = '#d4edda';
                        cooldownSpan.style.color = '#155724';
                    }
                }, 3000);
            }
        });
    } else {
        cooldownSpan.textContent = '❌ Вне поля!';
        cooldownSpan.style.background = '#f8d7da';
        cooldownSpan.style.color = '#721c24';
        setTimeout(() => {
            if (cooldownSpan.textContent.includes('Вне поля')) {
                cooldownSpan.textContent = '✅ Готов';
                cooldownSpan.style.background = '#d4edda';
                cooldownSpan.style.color = '#155724';
            }
        }, 1000);
    }
});

// Панорамирование (правая кнопка)
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
        e.preventDefault();
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        canvas.style.cursor = 'grabbing';
    }
});

window.addEventListener('mousemove', (e) => {
    if (isDragging) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        const rect = canvas.getBoundingClientRect();
        const factor = canvas.width / rect.width;
        
        offsetX += dx * factor;
        offsetY += dy * factor;
        
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        draw();
    }
});

window.addEventListener('mouseup', () => {
    isDragging = false;
    canvas.style.cursor = 'crosshair';
});

// Зум
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(20, Math.max(0.5, scale * delta));
    
    const rect = canvas.getBoundingClientRect();
    const factorX = canvas.width / rect.width;
    const factorY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * factorX;
    const mouseY = (e.clientY - rect.top) * factorY;
    
    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;
    
    scale = newScale;
    offsetX = mouseX - (worldX * scale);
    offsetY = mouseY - (worldY * scale);
    
    draw();
});

// Кнопки управления
document.getElementById('resetView').addEventListener('click', () => {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    draw();
});

document.getElementById('zoomIn').addEventListener('click', () => {
    scale = Math.min(20, scale * 1.2);
    draw();
});

document.getElementById('zoomOut').addEventListener('click', () => {
    scale = Math.max(0.5, scale / 1.2);
    draw();
});

// Отображение координат
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const factorX = canvas.width / rect.width;
    const factorY = canvas.height / rect.height;
    const screenX = (e.clientX - rect.left) * factorX;
    const screenY = (e.clientY - rect.top) * factorY;
    const { x, y } = getPixelFromScreen(screenX, screenY);
    
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
        coordinatesSpan.textContent = `📍 X:${x} Y:${y}`;
    } else {
        coordinatesSpan.textContent = `📍 X:- Y:-`;
    }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// WebSocket
socket.on('region_update', (data) => {
    data.pixels.forEach(pixel => {
        pixelCache.set(`${pixel.x},${pixel.y}`, pixel.color);
    });
    draw();
});

socket.on('pixel_update', (data) => {
    pixelCache.set(`${data.x},${data.y}`, data.color);
    draw();
});

socket.on('online_count', (count) => {
    document.getElementById('onlineCount').textContent = count;
});

socket.on('connect', () => {
    console.log('✅ Подключено!');
    socket.emit('request_region', { 
        minX: 0, 
        maxX: GRID_SIZE - 1, 
        minY: 0, 
        maxY: GRID_SIZE - 1 
    });
});

// Запуск
createPalette();
draw();
console.log('🎮 Pixel Battle готов!');