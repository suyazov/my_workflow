# Регламент работы с Figma для вёрстки лендингов

Цель: сверстать сайт максимально близко к макету Figma, используя данные Dev Mode/API, экспортированные ассеты и инструментальную проверку, а не глазомер.

Главное правило: лучше остановиться и сообщить о проблеме, чем заменить элемент макета похожим.

---

## 0. Жёсткие правила для ИИ-агента

Этот регламент выполняется в режиме pixel-perfect. Агент не имеет права интерпретировать макет творчески.

Источник истины:

1. Figma node id.
2. Данные Figma Dev Mode/API.
3. Экспортированные из Figma SVG/PNG/WebP.
4. Скриншот сравнения `Figma vs Site`.
5. DOM-замеры и visual diff.

Запрещено:

- заменять иконки, декоративные элементы, SVG, картинки и формы на похожие;
- использовать другие элементы из соседних блоков макета;
- менять тип элемента: декоративная иконка не может стать кнопкой, кругом, плюсом, стрелкой или другой фигурой;
- растягивать карточку или секцию на всю ширину, если в Figma у неё задана конкретная ширина;
- убирать `border-radius`, тени, обводки, opacity, gradient, если они есть в Figma;
- менять количество дочерних элементов внутри блока;
- придумывать недостающие элементы;
- заменять сложную векторную фигуру CSS-иконкой, emoji, Font Awesome, Lucide, Heroicons или похожим символом;
- писать «готово», если хотя бы один обязательный элемент блока не сверен с Figma;
- сдавать блок без скриншотов `figma-reference.png`, `site-result.png`, `diff.png`.

Если элемент из Figma не получается точно воспроизвести, агент обязан:

1. остановиться;
2. указать `node_id` проблемного элемента;
3. описать, что именно не получилось экспортировать или сверстать;
4. не заменять элемент похожим;
5. поставить статус `НЕ СДАНО`.

Пример критической ошибки:

- В Figma: зелёный декоративный крест.
- На сайте: белый круг с плюсом.
- Результат: `FAIL`. Блок не сдаётся.

---

## 1. Подготовка проекта

### 1.1 Необходимые данные

- **Figma file key** — из URL макета: `https://www.figma.com/design/<FILE_KEY>/<NAME>?node-id=<NODE_ID>`.
- **Figma API token** — личный токен разработчика.
- **Node ID целевого артборда** — берётся из `node-id=...` в URL или из Dev Mode.
- **Node ID каждого крупного блока** — hero, about, services, benefits, cases, footer и т.д.
- **SSH-доступ** к серверу, где будет сайт, либо локальный путь для деплоя.
- **URL тестового сайта** для проверки результата.

### 1.2 Инструменты

- `curl` + `jq` для запросов к Figma API.
- `node` + `puppeteer` или `chromium-browser` для скриншотов и DOM-замеров.
- `pixelmatch` / `looks-same` / аналогичный инструмент для visual diff.
- `sharp`, `cwebp` или `convert` для подготовки изображений.
- `rsync` для деплоя на сервер.
- DevTools браузера для проверки цветов, размеров и computed styles.

### 1.3 Рабочие файлы, которые нужно создать

Перед началом вёрстки агент создаёт рабочую папку проверки:

```text
/figma-audit
  figma_node_<NODE_ID>.json
  figma_elements.json
  figma_blocks_manifest.json
  figma_assets_manifest.json
  figma-reference.png
  site-result.png
  diff.png
  dom-measurements.json
  comparison-report.md
```

Если этих файлов нет, работа не считается проверенной.

---

## 2. Извлечение данных из Figma

### 2.1 Получить структуру артборда

```bash
FIGMA_TOKEN="figd_..."
FILE_KEY="cU6O3Xlsar8HPCleslQ11O"
NODE_ID="22:2"

curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=$NODE_ID" \
  > figma_node_${NODE_ID//:/_}.json
```

### 2.2 Получить экспортированные изображения

```bash
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY/images" \
  > figma_images.json
```

### 2.3 Распарсить полный реестр элементов

Перед вёрсткой нужно создать `figma_elements.json` — полный реестр всех элементов целевого артборда.

В реестр обязательно включать:

- `id` — Figma node id;
- `name` — имя слоя;
- `type` — `TEXT`, `FRAME`, `GROUP`, `RECTANGLE`, `VECTOR`, `INSTANCE`, `COMPONENT`, `ELLIPSE`, `LINE`, `BOOLEAN_OPERATION`, `STAR`, `POLYGON`;
- `characters` — текст, если это `TEXT`;
- `absoluteBoundingBox` — `x`, `y`, `width`, `height`;
- `absoluteRenderBounds` — реальные границы отрисовки;
- `relative` — координаты относительно целевого артборда;
- `fills` — цвета, изображения, градиенты;
- `strokes` — обводки;
- `strokeWeight`;
- `cornerRadius`;
- `rectangleCornerRadii`;
- `opacity`;
- `blendMode`;
- `effects` — тени, blur;
- `constraints`;
- `layoutMode`;
- `itemSpacing`;
- `paddingLeft`, `paddingRight`, `paddingTop`, `paddingBottom`;
- `style` — `fontFamily`, `fontSize`, `fontWeight`, `lineHeightPx`, `letterSpacing`;
- `componentId` — если элемент является `INSTANCE`;
- `children_count` — количество дочерних элементов;
- `children_ids` — список ID дочерних элементов.

Важно: нельзя фильтровать только `TEXT`, `RECTANGLE`, `FRAME`. Нужно собирать также `GROUP`, `VECTOR`, `INSTANCE`, `COMPONENT`, `ELLIPSE`, `LINE`, `BOOLEAN_OPERATION`, `STAR`, `POLYGON`, иначе агент может потерять декоративные элементы и заменить их на выдуманные.

Пример скрипта:

```js
const fs = require('fs');

const NODE_ID = process.env.NODE_ID || '22:2';
const safeNodeId = NODE_ID.replace(':', '_');
const data = JSON.parse(fs.readFileSync(`figma_node_${safeNodeId}.json`, 'utf8'));
const doc = data.nodes[NODE_ID].document;
const frame = doc.absoluteBoundingBox || { x: 0, y: 0 };

function cleanPaint(paint) {
  if (!paint) return paint;
  return {
    type: paint.type,
    visible: paint.visible,
    opacity: paint.opacity,
    color: paint.color,
    gradientStops: paint.gradientStops,
    imageRef: paint.imageRef,
    scaleMode: paint.scaleMode,
  };
}

function walk(n, arr = []) {
  const b = n.absoluteBoundingBox || {};
  const rb = n.absoluteRenderBounds || {};
  const s = n.style || {};

  arr.push({
    id: n.id,
    name: n.name,
    type: n.type,
    characters: n.characters || null,
    absoluteBoundingBox: n.absoluteBoundingBox || null,
    absoluteRenderBounds: n.absoluteRenderBounds || null,
    relative: {
      x: Math.round((b.x || 0) - (frame.x || 0)),
      y: Math.round((b.y || 0) - (frame.y || 0)),
      w: Math.round(b.width || 0),
      h: Math.round(b.height || 0),
      renderX: rb.x ? Math.round(rb.x - (frame.x || 0)) : null,
      renderY: rb.y ? Math.round(rb.y - (frame.y || 0)) : null,
      renderW: rb.width ? Math.round(rb.width) : null,
      renderH: rb.height ? Math.round(rb.height) : null,
    },
    fills: (n.fills || []).map(cleanPaint),
    strokes: (n.strokes || []).map(cleanPaint),
    strokeWeight: n.strokeWeight || null,
    cornerRadius: n.cornerRadius || null,
    rectangleCornerRadii: n.rectangleCornerRadii || null,
    opacity: n.opacity ?? 1,
    blendMode: n.blendMode || null,
    effects: n.effects || [],
    constraints: n.constraints || null,
    layoutMode: n.layoutMode || null,
    itemSpacing: n.itemSpacing || null,
    paddingLeft: n.paddingLeft || 0,
    paddingRight: n.paddingRight || 0,
    paddingTop: n.paddingTop || 0,
    paddingBottom: n.paddingBottom || 0,
    style: {
      fontFamily: s.fontFamily || null,
      fontSize: s.fontSize || null,
      fontWeight: s.fontWeight || null,
      lineHeightPx: s.lineHeightPx || null,
      letterSpacing: s.letterSpacing || null,
      textCase: s.textCase || null,
      textDecoration: s.textDecoration || null,
    },
    componentId: n.componentId || null,
    children_count: (n.children || []).length,
    children_ids: (n.children || []).map(c => c.id),
  });

  (n.children || []).forEach(c => walk(c, arr));
  return arr;
}

const elements = walk(doc);
fs.writeFileSync('figma_elements.json', JSON.stringify(elements, null, 2));
console.log(`Saved ${elements.length} elements to figma_elements.json`);
```

### 2.4 Создать manifest блоков

Каждый крупный блок должен иметь собственный manifest в `figma_blocks_manifest.json`.

Пример:

```json
{
  "blocks": [
    {
      "block_name": "Кому подходит",
      "figma_node_id": "xxx:yyy",
      "role": "section/card",
      "required_children": [
        {
          "node_id": "xxx:1",
          "name": "Кому подходит",
          "type": "TEXT",
          "required": true
        },
        {
          "node_id": "xxx:2",
          "name": "Работаем со стоматологиями на разных этапах",
          "type": "TEXT",
          "required": true
        },
        {
          "node_id": "xxx:3",
          "name": "description",
          "type": "TEXT",
          "required": true
        },
        {
          "node_id": "xxx:4",
          "name": "decorative-icon",
          "type": "VECTOR",
          "required": true,
          "export_as": "svg"
        }
      ],
      "forbidden_replacements": [
        "white circle plus",
        "font icon",
        "emoji",
        "icon from another block"
      ]
    }
  ]
}
```

Если в DOM после вёрстки количество элементов, их типы или визуальные роли отличаются от manifest — работа считается неготовой.

### 2.5 Правило работы с иконками, SVG и декоративными элементами

Все декоративные элементы из Figma должны быть либо:

1. экспортированы из Figma как SVG/PNG/WebP;
2. либо воссозданы CSS только если это простая фигура и все её параметры явно извлечены из Figma.

Правило по типам:

| Тип в Figma | Как верстать |
|---|---|
| `VECTOR` | Экспортировать как SVG |
| `INSTANCE` | Экспортировать как SVG или PNG |
| `COMPONENT` | Экспортировать как SVG или PNG |
| `GROUP` со сложной геометрией | Экспортировать как SVG |
| `BOOLEAN_OPERATION` | Экспортировать как SVG |
| `STAR` / `POLYGON` | Экспортировать как SVG |
| Простая `RECTANGLE` | Можно CSS, если известны точные размеры, цвет, radius, opacity, stroke |
| Простая `ELLIPSE` | Можно CSS, если известны точные размеры, цвет, opacity, stroke |

Запрещено заменять:

- зелёный декоративный крест на белый плюс;
- декоративную иконку на кнопку;
- SVG из макета на Font Awesome / Lucide / Heroicons;
- SVG из макета на emoji;
- SVG из макета на похожий CSS-рисунок;
- один декоративный элемент на другой декоративный элемент из соседнего блока.

Если в макете стоит зелёная декоративная иконка, на сайте должна быть именно она: тот же цвет, размер, позиция, opacity и форма.

Если элемент не найден или не экспортируется, нужно оставить технический комментарий в отчёте:

```text
НЕ СДАНО: не удалось экспортировать node_id=xxx:yyy, элемент не заменялся.
```

### 2.6 Экспорт ассетов из Figma

Для всех элементов типов `VECTOR`, `INSTANCE`, `COMPONENT`, `GROUP`, `BOOLEAN_OPERATION`, `STAR`, `POLYGON`, которые нельзя надёжно воссоздать CSS, нужно получить ссылки на экспорт.

```bash
ASSET_NODE_IDS="xxx:4,xxx:8,xxx:15"

curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FILE_KEY?ids=$ASSET_NODE_IDS&format=svg" \
  > figma_assets_manifest.json
```

После экспорта агент обязан проверить:

- файл скачан;
- файл подключён в проекте;
- размер SVG/PNG соответствует Figma;
- элемент стоит в правильной позиции;
- элемент не заменён другим ассетом.

---

## 3. Сравнение макета с живым сайтом

### 3.1 Запустить локальный/тестовый сайт

Сайт должен быть доступен по URL, например:

```text
https://test2.sy3.ru/
```

Перед проверкой нужно отключить влияние кеша:

```text
https://test2.sy3.ru/?measure=<timestamp>
```

### 3.2 Замерить DOM-координаты

```js
const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
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
      if (!el) {
        out[key] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      out[key] = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        borderRadius: cs.borderRadius,
        opacity: cs.opacity,
      };
    }
    return out;
  }, selectors);

  fs.writeFileSync('dom-measurements.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
```

### 3.3 Сравнить с Figma и составить дельту

| Элемент | Figma | Сайт | Разница | Действие |
|---|---|---|---|---|
| hero title | x=100, y=294 | x=120, y=350 | Δx=20, Δy=56 | Поправить padding/margin |
| button | y=593 | y=650 | Δy=57 | Уменьшить отступ subtitle |
| decorative icon | VECTOR xxx:4 | white plus button | Подмена элемента | FAIL, вернуть SVG из Figma |

Цель: разница не более 2–4 px по ключевым элементам первого экрана и не более 4 px по ключевым элементам остальных блоков.

Исключение: адаптивные состояния могут иметь другую геометрию, если для них нет отдельного макета. Но подмена элементов запрещена всегда.

---

## 4. Внесение правок

### 4.1 Принципы внесения правок

Источник истины — только Figma node id и данные из Dev Mode/API.

Перед изменением блока агент обязан:

1. определить node id блока;
2. выгрузить все дочерние элементы блока;
3. составить список обязательных элементов;
4. сверить, что в реализации присутствуют все элементы из Figma;
5. убедиться, что не добавлены лишние элементы;
6. проверить, что декоративные элементы экспортированы или точно восстановлены;
7. проверить, что блок не изменил свою визуальную роль.

Для каждого блока фиксируются:

- ширина;
- высота;
- x/y позиция внутри артборда;
- `border-radius`;
- background;
- padding;
- gap;
- расположение всех текстов;
- расположение всех иконок;
- цвета;
- шрифты;
- размеры;
- line-height;
- opacity;
- stroke;
- effects.

Карточка из Figma не должна превращаться в полноширинную секцию.

Если в Figma блок имеет скругление `12px`, ширину `750px` и высоту `163px`, агент не имеет права сделать прямоугольник `1200px` без скругления.

Любое отличие должно быть осознанным и зафиксированным в отчёте. Если отличия не согласованы — работа не считается выполненной.

### 4.2 Правило сохранения состава блока

Для каждого блока должно выполняться соответствие:

```text
Figma block children === Site block children
```

Допустимые отличия:

- технические wrapper-элементы, если они не меняют визуальный результат;
- адаптивные переносы текста, если нет отдельного mobile-макета;
- оптимизированный формат изображения, если визуально изображение совпадает.

Недопустимые отличия:

- отсутствие элемента из Figma;
- добавление визуально заметного элемента, которого нет в Figma;
- замена `VECTOR` на другой символ;
- замена декоративной формы на кнопку;
- замена формы, цвета или opacity декоративного элемента;
- изменение роли блока: карточка стала секцией, бейдж стал кнопкой, иконка стала интерактивным элементом.

### 4.3 Cache-busting

При любой смене файла:

- **CSS/JS:** менять query-string: `style.css?v=3` → `style.css?v=4`.
- **Изображения:** класть под новым именем: `hero-figma-v2.webp` вместо перезаписи `hero.webp`.
- **SVG:** при изменении класть под новым именем: `icon-cross-v2.svg`.

После деплоя проверить, что браузер получает новую версию файла.

### 4.4 Оптимизация изображений

```bash
# PNG -> WebP с ресайзом под 1920px по ширине
cwebp -q 82 -resize 1920 0 source.png -o hero-figma.webp

# Проверить вес
ls -lh hero-figma.webp
```

SVG из Figma не нужно заменять CSS, если это сложная фигура. SVG можно оптимизировать через SVGO, но нельзя менять геометрию.

---

## 5. Проверка

### 5.1 Скриншоты

Делать full-page скриншоты desktop и mobile.

```js
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.screenshot({ path: 'site-result-desktop.png', fullPage: true });

await page.setViewport({ width: 375, height: 812, isMobile: true, deviceScaleFactor: 1 });
await page.screenshot({ path: 'site-result-mobile.png', fullPage: true });
```

Минимальный набор скриншотов перед сдачей:

```text
figma-reference-desktop.png
site-result-desktop.png
diff-desktop.png
figma-reference-mobile.png
site-result-mobile.png
diff-mobile.png
```

Если mobile-макета в Figma нет, это нужно указать в отчёте.

### 5.2 Чек-лист перед сдачей

- [ ] HTTPS отдаёт `200 OK`.
- [ ] Создан `figma_elements.json`.
- [ ] Создан `figma_blocks_manifest.json`.
- [ ] Создан `figma_assets_manifest.json`.
- [ ] Все `VECTOR`, `INSTANCE`, `COMPONENT`, `GROUP` проверены.
- [ ] Первый экран по координатам совпадает с Figma ±4 px.
- [ ] Ключевые блоки совпадают с Figma ±4 px.
- [ ] Шрифты и размеры текста совпадают с макетом.
- [ ] Цвета проверены через DevTools / color picker.
- [ ] Все изображения оптимизированы.
- [ ] Все SVG соответствуют исходным Figma node id.
- [ ] Cache-busting применён.
- [ ] Мобильная версия проверена на 375px.
- [ ] Интерактивность работает: меню, галерея, формы, модалки.
- [ ] Нет выдуманных контактов/адресов, которых не было в ТЗ.
- [ ] Нет лишних декоративных элементов.
- [ ] Нет подменённых иконок.
- [ ] Подготовлены скриншоты `Figma vs Site`.
- [ ] Подготовлен `diff.png`.
- [ ] Подготовлен технический отчёт.

### 5.3 Проверка на подмену элементов

Перед сдачей агент обязан сделать проверку каждого блока:

| Проверка | Требование | Статус |
|---|---|---|
| Количество элементов | Совпадает с Figma manifest | pass/fail |
| Типы элементов | `TEXT` остаётся текстом, `VECTOR` остаётся SVG/VECTOR | pass/fail |
| Иконки | Не заменены на похожие | pass/fail |
| Цвета | Совпадают с Figma | pass/fail |
| Размеры блока | Совпадают с Figma ±4 px | pass/fail |
| Border-radius | Совпадает с Figma | pass/fail |
| Позиция элементов | Совпадает с Figma ±4 px | pass/fail |
| Лишние элементы | Отсутствуют | pass/fail |
| Визуальная роль | Не изменена | pass/fail |

Особое правило:

Если в макете есть декоративный элемент, а на сайте появился другой декоративный элемент, это не «частичное совпадение», а критическая ошибка.

Пример критической ошибки:

- В Figma: зелёный декоративный крест.
- На сайте: белый круг с плюсом.
- Результат: `FAIL`. Блок не сдаётся.

### 5.4 Fail-gate перед сообщением «готово»

Агент не имеет права писать «готово», если:

- есть хотя бы один `fail` в таблице проверки;
- есть незагруженный SVG/ассет;
- есть визуальный элемент без соответствующего Figma node id;
- есть элемент из Figma, которого нет на сайте;
- есть элемент на сайте, которого нет в Figma;
- не сделаны скриншоты сравнения;
- не создан `comparison-report.md`.

Разрешённые финальные статусы:

```text
СДАНО — все проверки pass.
НЕ СДАНО — есть fail, требуется исправление.
ТРЕБУЕТ УТОЧНЕНИЯ — невозможно продолжить без данных.
```

---

## 6. Полезные команды

```bash
# Проверить статус URL
curl -I -L https://test2.sy3.ru/

# Проверить размеры изображения
sips -g pixelWidth -g pixelHeight image.webp

# Найти все изображения в проекте
find . -name "*.png" -o -name "*.webp" -o -name "*.jpg" -o -name "*.svg"

# Проверить, что на сервере свежий файл
ssh server 'stat -c "%y %s" /var/www/test2.sy3.ru/css/style.css'

# Найти подключённые SVG
find . -name "*.svg" -maxdepth 5 -print

# Найти элементы, которые могли быть заменены иконками библиотек
 grep -R "fa-\|lucide\|heroicon\|material-icons" ./src ./public ./css ./js 2>/dev/null
```

---

## 7. Антипаттерны

1. Вёрстка «на глаз» без замеров — главная причина расхождений.
2. Перезапись файлов под тем же именем — кеш браузера/Cloudflare скроет изменения.
3. Использование картинок «как есть» без оптимизации — сайт тормозит.
4. Удаление блоков заказчика ради соответствия макету — макет и ТЗ могут расходиться.
5. Отсутствие DOM-замеров — скриншоты не покажут пиксельные отклонения.
6. Подмена иконок и SVG на похожие элементы — критическая ошибка.
7. Использование декоративных элементов из другого блока — критическая ошибка.
8. Превращение карточки в полноширинную секцию без указания в ТЗ — критическая ошибка.
9. Игнорирование `VECTOR`, `GROUP`, `INSTANCE`, `COMPONENT` при парсинге Figma — приводит к потере элементов.
10. Отрисовка сложных SVG через CSS без точных данных из Figma — запрещена.
11. Сдача без сверки `manifest Figma → DOM` — запрещена.
12. Сдача без скриншота `Figma vs Site` рядом — запрещена.
13. Использование иконок из библиотек вместо Figma-ассетов — запрещено, если это не согласовано.
14. Изменение визуальной роли элемента — критическая ошибка.
15. Самостоятельная правка композиции блока без явного требования — запрещена.

---

## 8. Шаблон технического отчёта агента

### 8.1 Обязательный технический отчёт

Агент обязан приложить к сдаче отчёт `comparison-report.md`.

Шаблон:

```text
Статус: СДАНО / НЕ СДАНО / ТРЕБУЕТ УТОЧНЕНИЯ

Проект:
URL Figma:
Figma file key:
Целевой node id:
URL тестового сайта:
Дата проверки:

Блок: Кому подходит
Figma node id: xxx:yyy

Проверка:
- Размер блока: pass/fail
- Border-radius: pass/fail
- Background: pass/fail
- Заголовок: pass/fail
- Описание: pass/fail
- Декоративная иконка: pass/fail
- Тип декоративной иконки: pass/fail
- Позиция декоративной иконки: pass/fail
- Лишние элементы: pass/fail
- Подмена элементов: pass/fail

Найденные отличия:
- нет / список отличий

Скриншоты:
- figma-reference.png
- site-result.png
- diff.png

Файлы проверки:
- figma_elements.json
- figma_blocks_manifest.json
- figma_assets_manifest.json
- dom-measurements.json
```

Если хотя бы один пункт имеет `fail`, агент не имеет права писать «готово».

### 8.2 Шаблон отчёта заказчику

```text
Готово: https://test2.sy3.ru/

Что сделано:
- Свёрстано по макету Figma, node-id <NODE_ID>.
- Блоки сверены по координатам, размерам, шрифтам, цветам и декоративным элементам.
- SVG/иконки экспортированы из Figma и не заменялись похожими элементами.
- Все изображения оптимизированы.
- CSS/JS подключены с cache-bust.
- Проверено на desktop 1440px и mobile 375px.

Контроль качества:
- figma_elements.json создан.
- figma_blocks_manifest.json создан.
- dom-measurements.json создан.
- Скриншоты Figma vs Site подготовлены.
- Критических расхождений нет.

Скриншоты:
- desktop.png
- mobile.png
- diff.png
```

Если есть отличия, писать так:

```text
Статус: НЕ СДАНО

Причина:
- В блоке <название> элемент node_id=<id> не совпадает с Figma.
- Ожидалось: <описание из Figma>.
- Сейчас на сайте: <фактическое отличие>.
- Элемент не заменялся похожим. Требуется исправление.
```

---

## 9. Специальное правило для ошибки с декоративным крестом и плюсом

Эта ошибка считается эталонным примером критического нарушения регламента.

Нельзя делать так:

```text
Figma: зелёный декоративный крест/звезда
Site: белый круг с плюсом
```

Почему это ошибка:

- изменён тип элемента;
- изменена форма;
- изменен цвет;
- изменена визуальная роль;
- декоративный элемент стал похож на кнопку;
- нарушен состав блока;
- блок визуально перестал соответствовать макету.

Как должно быть:

```text
Figma: VECTOR / GROUP / INSTANCE с зелёным декоративным крестом
Site: тот же SVG/ассет из Figma, в той же позиции, с тем же размером, цветом и opacity
```

Проверка перед сдачей:

```text
- decorative icon node id найден: pass/fail
- decorative icon экспортирован из Figma: pass/fail
- decorative icon подключён на сайте: pass/fail
- форма совпадает: pass/fail
- цвет совпадает: pass/fail
- позиция совпадает ±4 px: pass/fail
- не заменён на другую иконку: pass/fail
```

Если хотя бы один пункт `fail`, блок не сдаётся.

---

## 10. Финальное правило

Агент обязан работать по принципу:

```text
Не уверен → остановись.
Нет node id → не верстай на глаз.
Нет ассета → не заменяй похожим.
Есть fail → не пиши «готово».
```

Регламент создан для контроля качества вёрстки лендингов по Figma и предотвращения типовых ошибок: подмены элементов, изменения геометрии, потери декоративных ассетов, вёрстки на глаз и сдачи без проверки.
