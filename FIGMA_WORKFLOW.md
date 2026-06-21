# Регламент работы с Figma для вёрстки лендингов

Цель: сверстать сайт максимально близко к макету Figma, используя данные Dev Mode, а не глазомер.

---

## 1. Подготовка проекта

### 1.1 Необходимые данные
- **Figma file key** — из URL макета: `https://www.figma.com/design/<FILE_KEY>/<NAME>?node-id=<NODE_ID>`.
- **Figma API token** — личный токен разработчика.
- **Node ID целевого артборда** — берётся из `node-id=...` в URL или из Dev Mode.
- **SSH-доступ** к серверу, где будет сайт, либо локальный путь для деплоя.

### 1.2 Инструменты
- `curl` + `jq` для запросов к Figma API.
- `node` + `puppeteer` или `chromium-browser` для скриншотов и DOM-замеров.
- `cwebp` / `convert` (ImageMagick) для оптимизации изображений.
- `rsync` для деплоя на сервер.

---

## 2. Извлечение данных из Figma

### 2.1 Получить структуру артборда

```bash
FIGMA_TOKEN="figd_..."
FILE_KEY="cU6O3Xlsar8HPCleslQ11O"
NODE_ID="22:2"

curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=$NODE_ID" \
  > figma_node_$NODE_ID.json
```

### 2.2 Получить все экспортированные изображения

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY/images" \
  > figma_images.json
```

### 2.3 Распарсить ключевые параметры

Используй скрипт для извлечения:
- `absoluteBoundingBox` — координаты и размеры.
- `style` — шрифт, размер, межстрочный интервал, цвет, регистр.
- `fills` — цвета фона и градиенты.
- `stroke` — рамки.
- `effects` — тени.
- `imageRef` — ссылки на картинки.

Пример скрипта:

```js
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('figma_node_22_2.json', 'utf8'));
const doc = data.nodes['22:2'].document;
const frame = doc.absoluteBoundingBox;

function walk(n, arr = []) {
  arr.push(n);
  (n.children || []).forEach(c => walk(c, arr));
  return arr;
}

const nodes = walk(doc);
const result = nodes
  .filter(n => n.type === 'TEXT' || n.type === 'RECTANGLE' || n.type === 'FRAME')
  .map(n => {
    const b = n.absoluteBoundingBox || {};
    const s = n.style || {};
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      text: n.characters ? n.characters.trim().slice(0, 100) : null,
      x: Math.round((b.x || 0) - frame.x),
      y: Math.round((b.y || 0) - frame.y),
      w: Math.round(b.width || 0),
      h: Math.round(b.height || 0),
      font: s.fontFamily,
      size: s.fontSize,
      lineHeight: s.lineHeightPx,
      weight: s.fontWeight,
    };
  });

fs.writeFileSync('figma_elements.json', JSON.stringify(result, null, 2));
```

---

## 3. Сравнение макета с живым сайтом

### 3.1 Запустить локальный/тестовый сайт

Сайт должен быть доступен по URL, например `https://test2.sy3.ru/`.

### 3.2 Замерить DOM-координаты

```js
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('https://test2.sy3.ru/?measure=' + Date.now(), { waitUntil: 'networkidle2' });

  const selectors = {
    heroTitle: '.hero__title',
    heroSubtitle: '.hero__subtitle',
    heroBtn: '.hero .btn',
    statsValue: '.stat:nth-child(1) .stat__value',
    footerForm: '.footer__form',
  };

  const result = await page.evaluate(sel => {
    const out = {};
    for (const [key, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) { out[key] = null; continue; }
      const r = el.getBoundingClientRect();
      out[key] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return out;
  }, selectors);

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
```

### 3.3 Сравнить с Figma и составить дельту

| Элемент | Figma | Сайт | Разница | Действие |
|---------|-------|------|---------|----------|
| hero title | x=100, y=294 | x=120, y=350 | Δx=20, Δy=56 | Поправить padding/margin |
| button | y=593 | y=650 | Δy=57 | Уменьшить отступ subtitle |

Цель: разница не более 2–4 px по ключевым элементам первого экрана.

---

## 4. Внесение правок

### 4.1 Принципы
- Использовать **точные значения из Figma**: размеры, отступы, шрифты, цвета.
- Не выдумывать отступы «на глаз».
- Не удалять блоки, добавленные заказчиком, если они не противоречат макету.

### 4.2 Cache-busting

При любой смене файла:
- **CSS/JS:** менять query-string: `style.css?v=3` → `style.css?v=4`.
- **Изображения:** класть под новым именем: `hero-figma.webp` вместо перезаписи `hero.webp`.

### 4.3 Оптимизация изображений

```bash
# PNG -> WebP с ресайзом под 1920px по ширине
cwebp -q 82 -resize 1920 0 source.png -o hero-figma.webp

# Проверить вес
ls -lh hero-figma.webp
```

---

## 5. Проверка

### 5.1 Скриншоты

Делать full-page скриншоты desktop (1440px) и mobile (375px).

```js
await page.setViewport({ width: 1440, height: 900 });
await page.screenshot({ path: 'desktop.png', fullPage: true });

await page.setViewport({ width: 375, height: 812, isMobile: true });
await page.screenshot({ path: 'mobile.png', fullPage: true });
```

### 5.2 Чек-лист перед сдачей

- [ ] HTTPS отдаёт `200 OK`.
- [ ] Первый экран по координатам совпадает с Figma ±4 px.
- [ ] Шрифты и размеры текста совпадают с макетом.
- [ ] Цвета проверены через color picker / DevTools.
- [ ] Все изображения оптимизированы (< 300 KB для hero, < 100 KB для мелких).
- [ ] Cache-busting применён (новые имена файлов / `?v=N`).
- [ ] Мобильная версия проверена на 375px.
- [ ] Интерактивность работает: меню, галерея, формы, модалки.
- [ ] Нет выдуманных контактов/адресов, которых не было в ТЗ.

---

## 6. Полезные команды

```bash
# Проверить статус URL
curl -I -L https://test2.sy3.ru/

# Проверить размеры изображения
sips -g pixelWidth -g pixelHeight image.webp

# Найти все изображения в проекте
find . -name "*.png" -o -name "*.webp" -o -name "*.jpg"

# Проверить, что на сервере свежий файл
ssh server 'stat -c "%y %s" /var/www/test2.sy3.ru/css/style.css'
```

---

## 7. Антипаттерны

1. **Вёрстка «на глаз»** без замеров — главная причина расхождений.
2. **Перезапись файлов под тем же именем** — кеш браузера/Cloudflare скроет изменения.
3. **Использование картинок «как есть»** без оптимизации — сайт тормозит.
4. **Удаление блоков заказчика** ради соответствия макету — макет и ТЗ могут расходиться.
5. **Отсутствие DOM-замеров** — скриншоты не покажут пиксельные отклонения.

---

## 8. Шаблон отчёта заказчику

```
Готово: https://test2.sy3.ru/

Что сделано:
- Свёрстано по макету Figma (frame «Desktop - 2», node-id 22:2).
- Hero выровнен по координатам: title x=100, y=294; button y=593.
- Форма в подвале: x=863, w=335 (как в макете).
- Галерея работ кликабельна (lightbox).
- Все изображения оптимизированы, CSS/JS с cache-bust.
- Проверено на desktop (1440px) и mobile (375px).

Скриншоты:
- desktop.png
- mobile.png
```

---

*Регламент создан на основе опыта верстки лендинга «ПрофСтрой».*
