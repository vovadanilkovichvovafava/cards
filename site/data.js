// ============================================================
//  Всё, что нужно менять под себя, — в этом файле.
// ============================================================

window.CONFIG = {
  brand: "Aniverse Flip",
  tagline: "Стерео-карточки по аниме",
  // Ник в Telegram без @ — на него ведёт кнопка «Заказать»
  telegram: "bakayaarou",
  // Соцсети для иконок в шапке: полная ссылка. Пусто — иконка покажет «скоро».
  instagram: "https://www.instagram.com/aniverse_3dcards",
  tiktok: "https://www.tiktok.com/@aniverse_3dcards",
  telegramChannel: "https://t.me/Aniverse_3Dcards", // канал; заказы по-прежнему идут на ник выше
  // Цены — ЗАМЕНИ на свои
  prices: {
    common: 350,   // обычная карточка
    special: 450,  // особая карточка
    custom: 900,   // карточка по фото (ты / друг)
  },
  currency: "₽",
  // Переключатель BYN | RUS в шапке: цены в белорусских рублях считаются по этому курсу
  // (сколько BYN за 1 ₽) и округляются до целого. ПРОВЕРЬ курс перед запуском.
  bynPerRub: 0.035,
  production: "3–7 дней",
  // Акция 4+1: за каждые 4 карточки в заказе — мистери-карточка в подарок. false — выключить.
  promo41: true,
  // Акции на главной. Пустой список — блок «Акции» скрыт.
  // action: "buycollection" — список серий, нажатие открывает заказ всей серии целиком
  promos: [
    { tag: "4+1", title: "Четыре — твои, пятая — сюрприз",
      text: "Собери любые 4 карточки, а пятую мы добавим сами — мистери-карточку, которую ты увидишь только когда откроешь посылку.",
      link: "builder?promo=41", linkText: "Выбрать 4 карточки" },
    { tag: "Коллекция целиком", title: "Забери всю серию",
      text: "Все карточки одной вселенной разом — ровно то, что лежит на странице коллекции. Выбери серию, и мы соберём её целиком. Акция 4+1 тоже работает.",
      action: "buycollection" },
  ],
};

// Вселенные (аниме). back — задник карточки, accent — цвет рамки для карточек «по фото»
window.UNIVERSES = [
  {
    id: "berserk",
    name: "Берсерк",
    icon: "assets/brand/icon-berserk.jpg",
    banner: "assets/brand/banner-berserk.jpg?v=3",
    back: "assets/backs/berserk.jpg",
    accent: "#e0262b",
    glow: "#d8112f", // цвет подсветки сцены на главной
  },
  {
    id: "mushoku",
    name: "Реинкарнация безработного",
    short: "Реинкарнация", // короткое имя — для плашек и подписи на витрине
    icon: "assets/brand/icon-mushoku.jpg",
    banner: null,
    back: "assets/backs/mushoku.jpg",
    accent: "#e9b44c",
    glow: "#c98a1e", // цвет подсветки сцены на главной
  },
  {
    id: "aot",
    name: "Атака титанов",
    mark: "Атака", // слово-фон за карточкой на главной (на компьютере)
    icon: "assets/brand/icon-aot.jpg",
    banner: "assets/brand/banner-aot.jpg?v=3",
    back: "assets/backs/aot.jpg",
    accent: "#4f8a4b",
    glow: "#2f9a55", // цвет подсветки сцены на главной
  },
  {
    id: "onepiece",
    name: "Ван Пис",
    icon: "assets/brand/icon-onepiece.jpg",
    banner: "assets/brand/banner-onepiece.jpg?v=3",
    back: "assets/backs/onepiece.jpg",
    accent: "#2f7fd6",
    glow: "#2466c9", // цвет подсветки сцены на главной
  },
];

// Готовые персонажи. Для каждой версии — пара кадров [ДО, ПОСЛЕ] (меняются при наклоне)
// quote — необязательный звук: играет, когда карточку открывают в отдельном окне.
//   Чтобы добавить: положи mp3 в assets/audio/ и впиши путь, например quote: "assets/audio/griffith.mp3"
window.CHARACTERS = [
  {
    id: "guts", universe: "berserk", name: "Гатс", subtitle: "Black Swordsman",
    quote: "assets/audio/guts.mp3",
    variants: {
      common: ["assets/cards/guts-common-a.jpg", "assets/cards/guts-common-b.jpg"],
      special: ["assets/cards/guts-special-a.jpg", "assets/cards/guts-special-b.jpg"],
    },
  },
  {
    id: "griffith", universe: "berserk", name: "Гриффит", subtitle: "White Hawk",
    variants: {
      common: ["assets/cards/griffith-common-a.jpg", "assets/cards/griffith-common-b.jpg"],
      special: ["assets/cards/griffith-special-a.jpg", "assets/cards/griffith-special-b.jpg"],
    },
  },
  {
    id: "rudeus", universe: "mushoku", name: "Рудеус",
    variants: { special: ["assets/cards/rudeus-special-a.jpg", "assets/cards/rudeus-special-b.jpg"] },
  },
  {
    id: "roxy", universe: "mushoku", name: "Рокси",
    variants: { special: ["assets/cards/roxy-special-a.jpg", "assets/cards/roxy-special-b.jpg"] },
  },
  {
    id: "eris", universe: "mushoku", name: "Эрис",
    variants: { special: ["assets/cards/eris-special-a.jpg", "assets/cards/eris-special-b.jpg"] },
  },
  {
    id: "sylphy", universe: "mushoku", name: "Сильфи",
    variants: { special: ["assets/cards/sylphy-special-a.jpg", "assets/cards/sylphy-special-b.jpg"] },
  },
  {
    id: "ruijerd", universe: "mushoku", name: "Руиджерд",
    variants: { special: ["assets/cards/ruijerd-special-a.jpg", "assets/cards/ruijerd-special-b.jpg"] },
  },
];

// Видео живых карточек убраны с сайта
window.VIDEOS = [];
