// Английская версия сайта. Язык выбирается по браузеру (см. partials/head.html): русский — для
// ru/be/uk/kk/ky/tg/uz, для остальных — английский и цены в долларах. Проверить вручную: ?lang=en / ?lang=ru.
// Тексты страниц переводятся на лету по словарю ниже; всё, что пишется Владу в Telegram, остаётся по-русски.
(() => {
  window.I18N = { lang: window.LANG || "ru" };
  if (window.I18N.lang !== "en") return;
  const { CONFIG, UNIVERSES, CHARACTERS, KNOWN_CHARACTERS } = window;

  // ---------------- Контент из data.js ----------------
  Object.assign(CONFIG, {
    tagline: "Anime lenticular cards",
    stockLabel: "In stock",
    production: "3–7 days",
  });
  const PROMOS_EN = [
    { title: "Two of yours — the third is on us",
      text: "Order two custom cards — with you, your friends or any character you like — and pick any card from the collection for free.",
      linkText: "Order 2 cards" },
    { title: "Four are yours, the fifth is a surprise",
      text: "Pick any 4 cards and we'll add a fifth — a mystery card you'll only see when you open the parcel.",
      linkText: "Pick 4 cards" },
    { tag: "Whole collection", title: "Take the whole series",
      text: "All cards of one universe at once — exactly what's on the collection page. Every fifth card of the series is free." },
  ];
  (CONFIG.promos || []).forEach((p, i) => PROMOS_EN[i] && Object.assign(p, PROMOS_EN[i]));

  const UNI_EN = {
    berserk: { name: "Berserk" },
    mushoku: { name: "Mushoku Tensei: Jobless Reincarnation", short: "Mushoku Tensei" },
    aot: { name: "Attack on Titan", mark: "Titan" },
    onepiece: { name: "One Piece" },
  };
  // Коллекции, добавленные через бота, приходят с русским названием
  const UNI_BY_NAME = {
    "берсерк": "Berserk", "атака титанов": "Attack on Titan", "ван пис": "One Piece", "наруто": "Naruto",
    "магическая битва": "Jujutsu Kaisen", "клинок рассекающий демонов": "Demon Slayer", "винланд": "Vinland Saga",
    "сага о винланде": "Vinland Saga", "блич": "Bleach", "токийский гуль": "Tokyo Ghoul", "человек-бензопила": "Chainsaw Man",
    "реинкарнация безработного": "Mushoku Tensei: Jobless Reincarnation", "поднятие уровня в одиночку": "Solo Leveling",
  };
  (UNIVERSES || []).forEach((u) => {
    Object.assign(u, UNI_EN[u.id] || {});
    const n = UNI_BY_NAME[(u.name || "").toLowerCase()];
    if (n) u.name = n;
  });
  (window.EXTRA_UNIVERSES || []).forEach((u) => {
    const n = UNI_BY_NAME[(u.name || "").toLowerCase()];
    if (n) u.name = n;
  });

  const CHAR_EN = {
    guts: { name: "Guts", full: "Guts",
      about: "The Black Swordsman, a mercenary wielding the giant Dragon Slayer sword. He survived the Eclipse with the Brand of Sacrifice and wages an endless war on demons, bowing to neither fate nor gods." },
    griffith: { name: "Griffith", full: "Griffith",
      about: "The White Hawk, leader of the Band of the Hawk. A charismatic, flawless strategist willing to pay any price for his dream of a kingdom of his own." },
    rudeus: { name: "Rudeus", full: "Rudeus Greyrat",
      about: "A man reborn in a world of magic who decided to live his new life for real. A magic prodigy, head of a big family and one of the strongest mages of his time." },
    roxy: { name: "Roxy", full: "Roxy Migurdia",
      about: "Rudeus's first teacher, a royal-rank water mage. Calm, wise and caring — she taught him not to fear the world outside his home." },
    eris: { name: "Eris", full: "Eris Greyrat",
      about: "A hot-tempered, fearless swordswoman. A disciple of the Sword God who trained for years to stand beside Rudeus and protect him." },
    sylphy: { name: "Sylphy", full: "Sylphiette",
      about: "Rudeus's childhood friend with a rare gift for silent magic. Bodyguard of Princess Ariel, kind and loyal — one of the warmest heroines of the series." },
    ruijerd: { name: "Ruijerd", full: "Ruijerd Superdia",
      about: "A Superd warrior with a spear and a third eye. A stern-looking protector of children who has spent years trying to restore his people's good name." },
  };
  (CHARACTERS || []).forEach((c) => {
    const e = CHAR_EN[c.id];
    c.nameRu = c.name; // по нему карточки из бота находят своего героя
    if (e) Object.assign(c, e);
    else if (c.about && /[а-яё]/i.test(c.about)) delete c.about;
  });

  // Известные герои для карточек из бота: английское имя — первое в списке names
  const KNOWN_EN = {
    "Mikasa Ackerman": "One of the main heroines of Attack on Titan. Since childhood she has shown incredible strength, a cool head and boundless devotion to Eren. A master of the omni-directional mobility gear and one of the Survey Corps' strongest fighters.",
    "Eren Yeager": "A boy who swore to wipe out every Titan after his mother's death. He joined the Survey Corps, learned he could turn into a Titan himself — and his drive for freedom ended up turning the whole world upside down.",
    "Levi Ackerman": "Captain of the Survey Corps, called humanity's strongest soldier. Quiet, meticulous, obsessed with cleanliness and tough as nails — unmatched in battle against Titans.",
    "Armin Arlert": "Eren and Mikasa's childhood friend. Not the strongest fighter, but a brilliant strategist whose plans saved the Survey Corps from hopeless situations more than once.",
    "Monkey D. Luffy": "Captain of the Straw Hat Pirates. He ate the Gum-Gum Devil Fruit and became made of rubber. Carefree, stubborn and endlessly loyal to his friends — he dreams of finding the One Piece and becoming King of the Pirates.",
    "Roronoa Zoro": "The Straw Hats' swordsman who fights with three katanas at once. He swore to become the world's greatest swordsman. Tough, tireless and completely hopeless with directions.",
    "Nami": "The Straw Hats' navigator. She reads the weather better than any instrument, loves money and tangerines, and dreams of drawing a complete map of the world.",
    "Usopp": "The Straw Hats' sniper and a master of tall tales. A bit of a coward, but he finds his courage when it matters and hits targets with his slingshot that no one else can reach.",
    "Vinsmoke Sanji": "The Straw Hats' cook who fights only with his legs to protect his hands for cooking. A gentleman with the ladies, he never leaves anyone hungry and dreams of finding the legendary All Blue.",
    "Tony Tony Chopper": "A reindeer who ate the Human-Human Fruit and became the Straw Hats' doctor. Kind and naive, he dreams of creating a cure for any disease.",
    "Nico Robin": "The Straw Hats' archaeologist, the only one who can read the ancient Poneglyphs. Calm and mysterious, she can sprout arms anywhere.",
    "Naruto Uzumaki": "A loud ninja from the Hidden Leaf Village with the Nine-Tailed Fox sealed inside him. An orphan shunned since childhood, he earned everyone's respect through sheer persistence and dreams of becoming Hokage.",
    "Sasuke Uchiha": "The last of the Uchiha clan and Naruto's eternal rival. A genius ninja with the Sharingan whose path of revenge for his destroyed clan took him far from home.",
    "Kakashi Hatake": "Leader of Team 7, the Copy Ninja with a Sharingan in his left eye. Always late and always reading his book, but in battle one of the Leaf's strongest shinobi.",
    "Itachi Uchiha": "Sasuke's older brother, a prodigy of the Uchiha clan and a member of the Akatsuki. A man who took a terrible crime upon himself for the sake of the village's peace and his little brother's life.",
    "Thorfinn": "Son of the great warrior Thors. As a child he swore revenge on his father's killer and grew up in a band of Vikings; after years of slavery he searches for a path where a man has no enemies.",
    "Thors": "Thorfinn's father, once a famed warrior of the Jomsvikings who gave up war for a peaceful life in Iceland. He taught his son that a true warrior needs no sword.",
    "Thorkell": "A giant, cheerful Viking who loves a good fight more than anything. Thorfinn's maternal great-uncle and one of the strongest warriors of his time.",
    "Canute": "A timid Danish prince who, after losing someone close, becomes a cold and determined ruler dreaming of building paradise on earth.",
    "Askeladd": "The cunning, charismatic leader of a Viking band who killed Thorfinn's father. A calculating strategist with a secret goal he hides from everyone.",
    "Ichigo Kurosaki": "A high-school student who can see ghosts and became a substitute Soul Reaper. He protects the living and the dead from Hollows with his huge sword Zangetsu and never leaves his friends in trouble.",
  };
  (KNOWN_CHARACTERS || []).forEach((k) => {
    k.full = k.names[0];
    k.about = KNOWN_EN[k.names[0]] || "";
  });

  // ---------------- Тексты интерфейса ----------------
  const DICT = {
    // Редактор карточки в конструкторе
    "Нажми на карточку — собери её сам": "Tap the card — make it yourself", "Собери свою карточку": "Make your own card",
    "Впиши имя и описание персонажа, добавь два кадра — карточка меняется сразу.": "Add the character's name and description and two frames — the card updates instantly.",
    "Имя персонажа": "Character name", "Как подписать героя": "Name on the card", "Описание персонажа": "Character description",
    "Кто он, чем силён, его девиз": "Who they are, their power, their motto", "при наклоне": "when tilted",
    "Готово, покрутить карточку": "Done — spin the card",
    "Нажми на фото, чтобы добавить кадр. Тяни, чтобы подвинуть. Нажми на имя или текст — и пиши.": "Tap the photo to add a frame. Drag to move it. Tap the name or text and type.",
    "Кадры": "Frames", "прямо": "straight on", "Нажми, чтобы добавить фото": "Tap to add a photo", "Нажми, чтобы добавить второй кадр": "Tap to add the second frame",
    "Нажми — впиши имя": "Tap — add a name", "Нажми — напиши о герое": "Tap — write about the hero", "Заменить фото": "Replace photo",
    "Добавь хотя бы первый кадр — без него карточку не нарисовать": "Add at least the first frame — we can't draw the card without it",
    // Отзывы
    "Отзывы": "Reviews", "Все отзывы": "All reviews", "Оставить отзыв": "Leave a review", "Отзывы — Aniverse Flip": "Reviews — Aniverse Flip",
    "Отзывы покупателей Aniverse Flip о стерео-карточках — и форма, чтобы оставить свой.": "Aniverse Flip customer reviews of our lenticular cards — and a form to leave your own.",
    "Оценка *": "Rating *", "Как тебя зовут *": "Your name *", "Имя — его увидят на сайте": "Name — shown on the site", "Отзыв *": "Review *",
    "Какие карточки заказывал, как доехали, как смотрятся вживую": "Which cards you ordered, how they arrived, how they look in person",
    "Отправить отзыв": "Send review", "Отзыв появится на сайте сразу. Мы читаем каждый и отвечаем здесь же.": "Your review appears on the site right away. We read every one and reply here.",
    "Спасибо за отзыв!": "Thanks for your review!", "Он уже на сайте — смотри ниже.": "It's already on the site — see below.",
    "В нём есть ссылка, поэтому он появится на сайте после проверки.": "It contains a link, so it will appear on the site after a check.",
    "Показать ещё": "Show more", "Сайт": "Website",
    "Фото или видео": "Photos or video", "+ Добавить фото или видео": "+ Add photos or video", "+ Добавить ещё": "+ Add more",
    "До 4 фото и одно видео до 30 МБ. Отзыв с файлами появится на сайте после проверки.": "Up to 4 photos and one video up to 30 MB. Reviews with files appear after a check.",
    "Убрать файл": "Remove file", "Фото к отзыву": "Review photo", "Готовим фото…": "Preparing photos…",
    "Он появится на сайте после проверки — обычно в течение дня.": "It will appear on the site after a check — usually within a day.",
    "Это не фото и не видео": "That's not a photo or a video", "Можно приложить одно видео": "You can attach one video",
    "Видео больше 30 МБ — обрежь его или выбери покороче": "The video is over 30 MB — trim it or pick a shorter one",
    "Можно приложить до 4 фото": "You can attach up to 4 photos",
    "Файлы слишком большие: видео — до 30 МБ, фото — до 3 МБ": "Files are too large: video up to 30 MB, photos up to 3 MB",
    "Не получилось принять файл — фото JPG/PNG, видео MP4, MOV или WebM": "Couldn't accept the file — photos JPG/PNG, video MP4, MOV or WebM",
    "Отзывов пока нет — будь первым, кто расскажет о своих карточках.": "No reviews yet — be the first to tell us about your cards.",
    "Не удалось загрузить отзывы. Обнови страницу чуть позже.": "Couldn't load reviews. Refresh the page a bit later.",
    "Поставь оценку — нажми на звёзды.": "Pick a rating — tap the stars.", "Напиши, как тебя зовут.": "Tell us your name.",
    "Отзыв слишком короткий — напиши хотя бы пару слов.": "The review is too short — write at least a few words.",
    "Не удалось отправить отзыв": "Couldn't send the review", "Не удалось сохранить отзыв": "Couldn't save the review",
    "Отзывы временно не принимаются": "Reviews are temporarily unavailable", "Напиши, как тебя зовут": "Tell us your name",
    "Поставь оценку от 1 до 5 звёзд": "Pick a rating from 1 to 5 stars", "Отзыв слишком короткий — напиши хотя бы пару слов": "The review is too short — write at least a few words",
    "Ты уже оставил отзывы сегодня — спасибо! Попробуй завтра": "You've already left reviews today — thanks! Try again tomorrow",
    // Общие
    "Aniverse Flip — стерео-карточки по аниме": "Aniverse Flip — anime lenticular cards",
    "Стерео-карточки по аниме": "Anime lenticular cards",
    "Главная": "Home", "Каталог": "Catalog", "Собрать": "Create", "Как это работает": "How it works", "О нас": "About us",
    "Контакты": "Contacts", "Меню": "Menu", "Закрыть": "Close", "Разделы": "Sections",
    "Найти персонажа или аниме": "Find a character or anime", "Поиск по каталогу": "Search the catalog",
    "Поиск": "Search", "Найти героя, коллекцию или карточку...": "Find a hero, collection or card...",
    "Звук цитат": "Quote sound", "Валюта цен": "Price currency", "Язык сайта": "Site language", "Избранное": "Favorites", "Корзина": "Cart",
    "Заказы и вопросы — в Telegram": "Orders and questions — on Telegram", "Написать в Telegram": "Message us on Telegram",
    "Собрать свою карточку": "Create your own card", "Заказать карточку": "Order a card", "Заказать": "Order",
    "Показать превью": "Show preview", "Подробнее": "Learn more", "Акция": "Deal", "Акции": "Deals",
    "Обычная": "Regular", "Особая": "Special", "Новинка": "New", "Под заказ": "Made to order", "под заказ": "made to order",
    "В наличии": "In stock", "Обратная сторона карточки": "Card back",
    "Нарисуем под заказ": "We'll draw it to order",
    // Главная
    "Стерео-карточки с любимыми персонажами аниме — или с тобой и твоими друзьями. Наклони — и картинка оживает.":
      "Lenticular cards with your favorite anime characters — or with you and your friends. Tilt it and the picture comes alive.",
    "Коллекционные карточки": "Collectible cards", "Коллекции: листай влево и вправо": "Collections: swipe left and right",
    "Ещё коллекции": "More collections", "Новинки": "New arrivals", "Весь каталог": "Full catalog",
    // Каталог и коллекции
    "Каталог — Aniverse Flip": "Catalog — Aniverse Flip", "Коллекция — Aniverse Flip": "Collection — Aniverse Flip",
    "Коллекции": "Collections", "Выбери вселенную — внутри все карточки серии.": "Pick a universe — all cards of the series are inside.",
    "Тяни карточку мышкой, чтобы повернуть.": "Drag a card with your mouse to turn it.",
    "Крути карточки пальцем.": "Spin the cards with your finger.", "Все коллекции": "All collections",
    "Арты этой серии ещё не выложены на сайт.": "Art for this series isn't on the site yet.",
    "Любого героя можно заказать уже сейчас.": "You can order any hero right now.",
    "Заказать своего персонажа": "Order your own character", "Карточки под заказ": "Cards made to order",
    "Арты скоро появятся на сайте": "Art coming to the site soon",
    "Все коллекции стерео-карточек Aniverse Flip: Берсерк, Реинкарнация безработного, Атака титанов, Ван Пис.":
      "All Aniverse Flip lenticular card collections: Berserk, Mushoku Tensei, Attack on Titan, One Piece.",
    "Карточки коллекции: покрути, выбери версию и закажи.": "Collection cards: spin, pick a version and order.",
    // Окно карточки
    "Предыдущая карточка": "Previous card", "Следующая карточка": "Next card", "В корзину": "Add to cart",
    "В избранное": "Add to favorites", "Убрать из избранного": "Remove from favorites",
    "В подарок или настроить": "As a gift or customize", "О персонаже": "About the character",
    "Другие коллекции": "Other collections", "Смотреть все →": "See all →", "за 1 штуку": "per card",
    // Избранное и корзина
    "Открыть каталог": "Open catalog", "Нажми на сердечко у карточки — она сохранится здесь.": "Tap the heart on a card — it will be saved here.",
    "Корзина пуста. Добавь карточки из каталога — оформим всё одним заказом.": "Your cart is empty. Add cards from the catalog — we'll put everything in one order.",
    "Меньше": "Less", "Больше": "More", "Больше 50 одинаковых карточек в один заказ не добавить": "You can't add more than 50 of the same card to one order",
    "Текст заказа скопирован — вставь его в чат": "Order text copied — paste it into the chat",
    "Открываю Telegram — опиши заказ в чате": "Opening Telegram — describe your order in the chat",
    // Оформление заказа
    "Оформление заказа": "Checkout", "Карточка": "Card", "Версия": "Version", "Количество": "Quantity", "Сумма": "Total",
    "Всего карточек": "Total cards", "Фото": "Photos", "Фраза": "Phrase", "Акция 4+1": "4+1 deal", "Акция 2+1": "2+1 deal",
    "Акция «Вся серия»": "Whole series deal", "Своя фраза вместо фразы с карточки": "Own phrase instead of the card's",
    "Фраза на карточке": "Phrase on the card",
    "Как к тебе обращаться": "What should we call you", "Имя": "Name", "Где тебе написать *": "Where should we message you *",
    "Ник в Telegram *": "Telegram username *", "Ник в TikTok *": "TikTok username *", "Ник в Instagram *": "Instagram username *",
    "Номер WhatsApp *": "WhatsApp number *", "Номер телефона *": "Phone number *", "Телефон": "Phone",
    "Комментарий": "Comment", "Пожелания, сроки, доставка": "Wishes, timing, shipping",
    "Согласен(на), что вы используете имя и контакт только чтобы связаться со мной по этому заказу —":
      "I agree that you use my name and contact only to reach me about this order —",
    "политика конфиденциальности": "privacy policy", "Отправить заказ": "Send order",
    "или написать нам в Telegram самому": "or message us on Telegram yourself",
    "Заказ отправлен!": "Order sent!", "Мы уже получили его и скоро напишем тебе, чтобы согласовать детали и оплату.":
      "We've got it and will message you soon to agree on the details and payment.",
    "Отлично": "Great", "Отправляем фото…": "Sending photos…", "Отправляем…": "Sending…",
    "Отметь согласие — без него мы не можем принять контакт.": "Please tick the consent box — we can't accept your contact without it.",
    "Не получилось прочитать фото — выбери другое (JPG или PNG)": "Couldn't read the photo — pick another one (JPG or PNG)",
    "Не удалось отправить заказ": "Couldn't send the order", "Сервер долго не отвечает": "The server is taking too long to respond",
    "Нет связи с сервером": "No connection to the server", "Слишком много заказов подряд, попробуй через минуту": "Too many orders in a row, try again in a minute",
    "Слишком большой заказ": "The order is too large", "Некорректные данные": "Invalid data", "Ошибка сервера": "Server error",
    // Конструктор
    "Собрать карточку — Aniverse Flip": "Create a card — Aniverse Flip",
    "Собери свою стерео-карточку: персонаж из аниме или ты сам по фото.": "Create your own lenticular card: an anime character or yourself from a photo.",
    "Собери свою": "Create your own", "карточку": "card", "Превью меняется сразу — его можно крутить.": "The preview updates instantly — and you can spin it.",
    "Кто будет на карточке?": "Who will be on the card?", "Персонаж аниме": "Anime character", "Я / друг по фото": "From your photo",
    "Какой персонаж нужен?": "Which character do you want?", "Например, Леви Аккерман": "For example, Levi Ackerman",
    "Нарисуем любого героя этой вселенной. Превью покажет оформление серии.": "We'll draw any hero of this universe. The preview shows the series design.",
    "Кадр 1": "Frame 1", "видно прямо": "seen straight on", "Кадр 2": "Frame 2", "видно при наклоне, можно не добавлять": "seen when tilted, optional",
    "Подвинь фото в карточке": "Position the photo in the card", "Тяни фото, чтобы подвинуть": "Drag the photo to move it", "Масштаб": "Zoom",
    "Тяни фото пальцем или мышкой — превью карточки меняется сразу. В заказ уйдёт именно этот кадр.":
      "Drag the photo with your finger or mouse — the card preview updates instantly. This exact framing goes into the order.",
    "Сбросить": "Reset", "Имя на карточке": "Name on the card", "Твоё имя или ник": "Your name or nickname", "Стиль серии": "Series style",
    "Фото остаются у тебя в браузере — никуда не загружаются, пока ты сам не отправишь их нам.":
      "Photos stay in your browser — nothing is uploaded until you send them to us yourself.",
    "Напиши свою: девиз, титул, любимая цитата": "Write your own: a motto, a title, a favorite quote", "Или возьми готовую": "Or pick a ready one",
    "Фраза героя": "Hero's phrase",
    "Оставь поле пустым — будет фраза, как на карточке. Своя фраза заменит её при печати.": "Leave it empty to keep the card's phrase. Your own phrase replaces it when printed.",
    "Фраза встанет внизу карточки — превью меняется сразу.": "The phrase goes at the bottom of the card — the preview updates instantly.",
    "Я не сдамся, пока бьётся сердце.": "I won't give up while my heart still beats.",
    "Сильнее всего тот, кто встаёт после падения.": "The strongest is the one who gets up after falling.",
    "Мечта стоит любой цены.": "A dream is worth any price.", "Защищу тех, кто мне дорог.": "I'll protect those dear to me.",
    "Мой путь — мои правила.": "My path, my rules.",
    "Версия карточки": "Card version", "Подарочная карточка": "Gift card", "Наклонить": "Tilt", "Обратная сторона": "Back side",
    "Итого": "Total", "Оформить заказ": "Checkout", "Заказ сразу придёт нам — мы напишем тебе сами": "The order comes straight to us — we'll message you",
    "Твоё имя": "Your name", "Твой герой": "Your hero", "Здесь будет текст о герое": "Text about the hero goes here",
    "Арт нарисуем специально под заказ": "We'll draw the art specially for you", "Подарок": "Gift", "Другой": "Other", "Любой": "Any",
    "без имени": "no name", "Персонаж не указан": "Character not specified",
    "Персонажи под заказ делаются в особой версии.": "Made-to-order characters come in the special version.",
    "— выбери карточку из каталога, она будет бесплатно.": "— pick a card from the catalog, it's free.",
    "Это не фото — выбери картинку JPG, PNG или HEIC": "That's not a photo — pick a JPG, PNG or HEIC image",
    "Фото больше 25 МБ — выбери поменьше": "The photo is over 25 MB — pick a smaller one",
    "Загрузи хотя бы одно фото — без него карточку не нарисовать": "Upload at least one photo — we can't draw the card without it",
    "Закажи 2 индивидуальные карточки — по фото или своего персонажа — и выбери любую карточку из каталога в подарок.":
      "Order 2 custom cards — from a photo or your own character — and pick any catalog card as a gift.",
    "Выбери 4 карточки — пятую, мистери-карточку, добавим в подарок.": "Pick 4 cards — we'll add a fifth, a mystery card, as a gift.",
    "Такого героя пока нет в каталоге — нарисуем под заказ.": "This hero isn't in the catalog yet — we'll draw them to order.",
    // Как это работает
    "Как это работает — Aniverse Flip": "How it works — Aniverse Flip",
    "Как заказать стерео-карточку Aniverse Flip: выбираешь героя, согласуем детали, печатаем, получаешь.":
      "How to order an Aniverse Flip lenticular card: pick a hero, we agree on details, we print, you receive.",
    "Как это": "How it", "работает": "works", "От выбора героя до карточки в руках — четыре шага.": "From picking a hero to the card in your hands — four steps.",
    "Выбираешь героя": "Pick a hero",
    "Готовую карточку из каталога, любого другого персонажа по запросу — или себя и друзей по фото.":
      "A ready card from the catalog, any other character on request — or yourself and friends from a photo.",
    "Привет! Заказ: Гатс, особая, 1 шт. Вот реквизиты для оплаты 👇": "Hi! Order: Guts, special, 1 pc. Here's how to pay 👇",
    "Доставка — по тарифу службы, сумму подскажем": "Shipping is at the carrier's rate, we'll tell you the amount",
    "Оплатил ✅": "Paid ✅", "Согласуем и оплачиваешь": "We agree and you pay",
    "Пишем тебе туда, где удобно: Telegram, TikTok или Instagram. Для карточек под заказ присылаем макет до печати. Заказ оплачивается по реквизитам, которые мы пришлём в чат, доставка — отдельно, по тарифу службы доставки.":
      "We message you wherever is convenient: Telegram, TikTok or Instagram. For made-to-order cards we send a mockup before printing. You pay using the details we send in the chat; shipping is separate, at the carrier's rate.",
    "Печатаем": "We print",
    "Два кадра совмещаем под линзовым покрытием — при наклоне они сменяют друг друга. Срок —":
      "We combine two frames under a lenticular layer — they switch as you tilt the card. Lead time —",
    "Карточки упакованы и отправлены 📦": "Cards packed and shipped 📦", "Трек-номер для отслеживания: ••• ••• •••": "Tracking number: ••• ••• •••",
    "Спасибо! Жду 🙌": "Thanks! Can't wait 🙌", "Отправляем": "We ship",
    "Упаковываем каждую карточку в защитный пакет и жёсткий конверт, чтобы она доехала без единой царапины. Отправляем удобной тебе службой доставки и присылаем в чат трек-номер.":
      "Each card goes into a protective sleeve and a rigid envelope so it arrives without a scratch. We ship with the carrier you prefer and send the tracking number in the chat.",
    "Выбрать карточку": "Pick a card", "Собрать свою": "Create your own", "Вопросы": "FAQ",
    "Что такое стерео-карточка?": "What is a lenticular card?",
    "Это карточка с линзовым покрытием: под одним углом видно один кадр, под другим — второй. На сайте эффект показан анимацией — наклони любую карточку в каталоге.":
      "It's a card with a lenticular layer: at one angle you see one frame, at another — the second. On the site the effect is animated — tilt any card in the catalog.",
    "Можно персонажа, которого нет в каталоге?": "Can I get a character that isn't in the catalog?",
    "Да. Выбери вселенную в конструкторе, нажми «Другой персонаж» и напиши имя. Если вселенной нет в списке — просто напиши нам.":
      "Yes. Pick a universe in the card creator, tap “Other” and type the name. If the universe isn't listed — just message us.",
    "Как сделать карточку с собой или другом?": "How do I make a card with myself or a friend?",
    "В конструкторе выбери «Я / друг по фото», загрузи 1–2 фото, впиши имя и текст. Мы нарисуем арт в стиле выбранного аниме и пришлём макет на согласование.":
      "In the card creator choose “From your photo”, upload 1–2 photos, add a name and text. We'll draw the art in the style of the chosen anime and send you a mockup to approve.",
    "Сколько ждать?": "How long does it take?", "Обычно": "Usually", "с момента согласования макета.": "from mockup approval.",
    "Как оплатить и получить?": "How do I pay and receive it?",
    "После оформления заказа мы напишем тебе туда, куда ты укажешь в форме — в Telegram, TikTok или Instagram. Там согласуем детали, доставку и оплату.":
      "After you place the order we'll message you wherever you tell us in the form — Telegram, TikTok or Instagram. There we'll agree on the details, shipping and payment.",
    // О нас
    "О нас — Aniverse Flip": "About us — Aniverse Flip",
    "Aniverse Flip — мастерская стерео-карточек по аниме. Готовые серии и карточки по фото.":
      "Aniverse Flip is an anime lenticular card studio. Ready-made series and cards from your photos.",
    "— мастерская стерео-карточек по аниме. Каждую карточку собираем из двух кадров, чтобы при наклоне герой оживал. Готовые серии — в каталоге, а любого другого персонажа или тебя самого нарисуем под заказ.":
      "is an anime lenticular card studio. Every card is made of two frames so the hero comes alive when you tilt it. Ready-made series are in the catalog, and we'll draw any other character — or you — to order.",
    "Печать за": "Printed in", "3–7 дней": "3–7 days", "после того, как согласуем арт": "after we approve the art",
    "Любой персонаж": "Any character", "нарисуем под заказ, даже если его нет в каталоге": "drawn to order, even if it's not in the catalog",
    "Связь там, где удобно": "We talk where it suits you", "Telegram, TikTok или Instagram": "Telegram, TikTok or Instagram",
    // Контакты
    "Контакты — Aniverse Flip": "Contacts — Aniverse Flip", "Контакты Aniverse Flip: почта, Telegram-бот, соцсети.": "Aniverse Flip contacts: email, Telegram bot, social media.",
    "Почта": "Email", "Канал": "Channel",
    "Заказы принимаем через сайт и Telegram-бота — отвечаем обычно в течение дня.": "We take orders through the site and the Telegram bot — we usually reply within a day.",
    // 404
    "Страница не найдена — Aniverse Flip": "Page not found — Aniverse Flip", "Такой страницы нет": "This page doesn't exist",
    "Возможно, ссылка устарела или в ней опечатка. Загляни в каталог — там все коллекции.": "The link may be outdated or have a typo. Check the catalog — all collections are there.",
    "На главную": "Home page",
    // Оферта и политика
    "Публичная оферта — Aniverse Flip": "Terms of sale — Aniverse Flip", "Условия покупки стерео-карточек Aniverse Flip.": "Terms of purchase for Aniverse Flip lenticular cards.",
    "Публичная оферта": "Terms of sale", "Настоящий сайт является публичной офертой.": "This website constitutes a public offer.",
    "Оформляя заказ, пользователь соглашается с условиями покупки.": "By placing an order, the user agrees to the terms of purchase.",
    "Товары представлены с описанием и ценой.": "Products are listed with a description and price.",
    "Оплата производится доступными способами, указанными на сайте.": "Payment is made by the available methods listed on the site.",
    "Возврат возможен в соответствии с законодательством Республики Беларусь.": "Returns are possible in accordance with the laws of the Republic of Belarus.",
    "Контакты:": "Contacts:", ", Telegram-бот": ", Telegram bot",
    "Политика конфиденциальности — Aniverse Flip": "Privacy policy — Aniverse Flip",
    "Как Aniverse Flip обрабатывает персональные данные покупателей.": "How Aniverse Flip processes customers' personal data.",
    "Политика конфиденциальности": "Privacy policy",
    "Мы собираем и обрабатываем персональные данные пользователей (имя, email и другие данные, вводимые на сайте) исключительно для обработки заказов и обратной связи.":
      "We collect and process users' personal data (name, email and other data entered on the site) solely to process orders and to get back to you.",
    "Пользователь даёт согласие на обработку персональных данных при отправке любой формы на сайте.": "The user consents to the processing of personal data when submitting any form on the site.",
    "Данные не передаются третьим лицам, за исключением случаев, предусмотренных законодательством.": "Data is not shared with third parties, except as required by law.",
    "Пользователь имеет право запросить удаление своих данных, написав на email": "The user may request deletion of their data by writing to",
  };

  const cards = (n) => `${n} ${+n === 1 ? "card" : "cards"}`;
  const rar = (s) => ({ "обычная": "regular", "особая": "special" }[s] || s);
  // Строки, собранные из частей: имя, число, цена. Проверяются по порядку, первая подходящая — побеждает
  const PATTERNS = [
    [/^(\d+) отзыв(?:а|ов)?$/, (m, n) => `${n} ${+n === 1 ? "review" : "reviews"}`],
    [/^Загружаем… (\d+)%$/, (m, n) => `Uploading… ${n}%`],
    [/^(\d+) из 5$/, (m, n) => `${n} of 5`],
    [/^Ответ (.+)$/, (m, x) => `Reply from ${x}`],
    [/^(\d+) карточ(?:ка|ки|ек|ку) — нажми, чтобы заказать$/, (m, n) => `${cards(n)} — tap to order`],
    [/^Коллекция, (\d+) карточ(?:ка|ки|ек)$/, (m, n) => `Collection, ${cards(n)}`],
    [/^(\d+) карточ(?:ка|ки|ек)(, (\d+) бесплатно)?$/, (m, n, f, k) => cards(n) + (f ? `, ${k} free` : "")],
    [/^\+(\d+) мистери-карточ(?:ка|ки|ек) в подарок( 🎁)?$/, (m, n, g) => `+${n} mystery ${+n === 1 ? "card" : "cards"} free${g || ""}`],
    [/^Акция 4\+1: \+(\d+) мистери-карточ(?:ка|ки|ек) в подарок 🎁$/, (m, n) => `4+1 deal: +${n} mystery ${+n === 1 ? "card" : "cards"} free 🎁`],
    [/^Акция 4\+1: добавь ещё (\d+) карточ(?:ку|ки|ек) — и получишь мистери-карточку в подарок$/, (m, n) => `4+1 deal: add ${cards(n)} more — and get a mystery card free`],
    [/^(.+) в корзине$/, (m, x) => `${x} added to cart`],
    [/^В корзине уже (\d+) позиций — оформи их, потом добавим ещё$/, (m, n) => `Your cart already has ${n} items — check out first, then add more`],
    [/^В корзину ещё одну \(сейчас (\d+)\)$/, (m, n) => `Add one more to cart (${n} now)`],
    [/^(.+) за штуку$/, (m, p) => `${p} each`],
    [/^(.+), от (.+)$/, (m, u, p) => `${u}, from ${p}`],
    [/^По фото: (.+), стиль «(.+)»$/, (m, n, s) => `From photo: ${n === "без имени" ? "no name" : n}, ${s} style`],
    [/^(.+) \(под заказ\), (.+)$/, (m, n, u) => `${n === "Персонаж не указан" ? "Character not specified" : n} (made to order), ${u}`],
    [/^У этого персонажа есть только (обычная|особая) версия\.$/, (m, r) => `This character only comes in the ${rar(r)} version.`],
    [/^в подарок: (.+)$/, (m, x) => `free: ${x}`],
    [/^в подарок (\d+) карточки из каталога \(первая: (.+), остальные выберем в чате\)$/, (m, n, x) => `${n} catalog cards free (first: ${x}, we'll pick the rest in the chat)`],
    [/^— тебе положено (\d+) подарочные карточки: первую выбери здесь, остальные — в чате\.$/, (m, n) => `— you get ${n} free cards: pick the first here, the rest in the chat.`],
    [/^(.+) — (.+), (обычная|особая)$/, (m, c, u, r) => `${c} — ${u}, ${rar(r)}`],
    [/^(.+), (.+), (обычная|особая)$/, (m, c, u, r) => `${c}, ${u}, ${rar(r)}`],
    [/^(.+), (обычная|особая)$/, (m, c, r) => `${c}, ${rar(r)}`],
    [/^(.+), (.+) \((обычная|особая)\)$/, (m, c, u, r) => `${c}, ${u} (${rar(r)})`],
    [/^Укажи, куда тебе написать: (.+)\.$/, (m, x) => {
      const k = Object.keys(DICT).find((d) => d.toLowerCase() === `${x} *`);
      return `Tell us where to message you: ${k ? DICT[k].replace(" *", "") : x}.`;
    }],
    [/^(.+)\. Попробуй ещё раз или напиши нам в Telegram — текст заказа скопируем\.$/, (m, w) => `${DICT[w] || w}. Try again or message us on Telegram — we'll copy the order text.`],
    [/^(.+) скоро появится — пока пиши нам в Telegram$/, (m, x) => `${x} is coming soon — message us on Telegram for now`],
    [/^Заказать «(.+)»$/, (m, x) => `Order “${x}”`],
    [/^Коллекция (.+)$/, (m, x) => `Collection: ${x}`],
    [/^Открыть (.+)$/, (m, x) => `Open ${x}`],
    [/^Убрать (.+)$/, (m, x) => `Remove ${x}`],
    [/^Видео (\d+)$/, (m, n) => `Video ${n}`],
    [/^(.+) — Aniverse Flip$/, (m, x) => `${x} — Aniverse Flip`],
    [/^(\d+) × (.+)$/, (m, n, p) => `${n} × ${p}`],
  ];
  const CY = /[а-яё]/i;
  function tr(s) {
    const key = s.replace(/\s+/g, " ").trim();
    if (!key || !CY.test(key)) return null;
    if (DICT[key]) return DICT[key];
    for (const [re, fn] of PATTERNS) {
      const m = re.exec(key);
      if (m) {
        const out = fn(...m);
        if (out !== key) return out;
      }
    }
    return null;
  }
  window.I18N.t = (s) => tr(s) || s;
  // Имя героя, которого нет в справочнике: латиницей по звучанию (Роальд → Roald)
  const TL = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
    р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  window.I18N.translit = (s) => s.replace(/[а-яё]/gi, (ch) => {
    const t = TL[ch.toLowerCase()] ?? ch;
    return ch === ch.toLowerCase() ? t : t.charAt(0).toUpperCase() + t.slice(1);
  });

  // ---------------- Перевод страницы на лету ----------------
  const ATTRS = ["placeholder", "aria-label", "title", "alt"];
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "NOSCRIPT"]);
  function trText(node) {
    const t = tr(node.nodeValue);
    if (t == null) return;
    const lead = node.nodeValue.match(/^\s*/)[0], tail = node.nodeValue.match(/\s*$/)[0];
    node.nodeValue = lead + t + tail;
  }
  function trEl(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && CY.test(v)) { const t = tr(v); if (t != null) el.setAttribute(a, t); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return trText(root);
    if (root.nodeType !== 1 || root.closest?.("[data-noi18n]")) return;
    trEl(root);
    if (SKIP.has(root.tagName)) return;
    // У полей ввода переводим подсказки (placeholder), но не содержимое
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.hasAttribute("data-noi18n") ? NodeFilter.FILTER_REJECT
        : n.nodeType === 3 && SKIP.has(n.parentNode.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? trText(n) : trEl(n);
  }
  const trTitle = () => { const t = tr(document.title); if (t != null) document.title = t; };
  document.querySelectorAll('meta[name="description"], meta[property^="og:"]').forEach((m) => {
    const t = m.content && tr(m.content);
    if (t != null) m.content = t;
  });
  walk(document.body);
  trTitle();
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") trText(m.target);
      else if (m.type === "attributes") trEl(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const title = document.querySelector("title");
  if (title) new MutationObserver(trTitle).observe(title, { childList: true, characterData: true, subtree: true });
  document.documentElement.classList.remove("i18n-wait");
})();
