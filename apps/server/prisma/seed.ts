import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ruSubjects = [
  "на завтрак",
  "в выходной",
  "в путешествии",
  "в офисе",
  "перед сном",
  "утром",
  "летом",
  "зимой",
  "на вечеринке",
  "в кафе",
  "дома",
  "в дороге",
  "на учебе",
  "на работе",
  "в спортзале",
  "в отпуске",
  "на море",
  "в парке",
  "в кино",
  "в магазине",
];

const ruActions = [
  "чаще выбирает",
  "скорее купит",
  "скорее попробует",
  "предпочтет",
  "быстрее заметит",
  "скорее сохранит",
  "чаще порекомендует",
  "скорее включит",
  "чаще наденет",
  "скорее возьмет с собой",
  "скорее использует",
  "скорее закажет",
  "чаще выберет первым",
  "скорее подарит",
  "скорее посмотрит",
  "чаще послушает",
  "скорее обновит",
  "чаще возьмет в аренду",
  "скорее добавит в избранное",
  "чаще откроет",
];

const ruOptions = [
  ["Чай", "Кофе", "Сок", "Вода"],
  ["Ноутбук", "Планшет", "Телефон", "Смарт-часы"],
  ["Пицца", "Суши", "Бургер", "Паста"],
  ["Книга", "Подкаст", "Фильм", "Игра"],
  ["Горы", "Море", "Город", "Дача"],
  ["Ранний подъем", "Поздний подъем", "Дневной сон", "Без сна"],
  ["Автобус", "Метро", "Такси", "Велосипед"],
  ["Кроссовки", "Ботинки", "Сандалии", "Тапки"],
  ["Сладкое", "Соленое", "Острое", "Кислое"],
  ["Сериал", "Фильм", "Шоу", "Стрим"],
  ["Онлайн", "Офлайн", "Гибрид", "Не важно"],
];

const enSubjects = [
  "for breakfast",
  "on weekends",
  "while traveling",
  "at the office",
  "before sleep",
  "in the morning",
  "in summer",
  "in winter",
  "at a party",
  "at a cafe",
  "at home",
  "on commute",
  "during study",
  "at work",
  "at the gym",
  "on vacation",
  "by the sea",
  "in a park",
  "at the cinema",
  "in a store",
];

const enActions = [
  "will choose",
  "is more likely to buy",
  "is more likely to try",
  "will prefer",
  "will notice first",
  "will save",
  "will recommend",
  "will turn on",
  "will wear",
  "will take along",
  "will use",
  "will order",
  "will pick first",
  "will gift",
  "will watch",
  "will listen to",
  "will upgrade",
  "will rent",
  "will add to favorites",
  "will open first",
];

const enOptions = [
  ["Tea", "Coffee", "Juice", "Water"],
  ["Laptop", "Tablet", "Phone", "Smartwatch"],
  ["Pizza", "Sushi", "Burger", "Pasta"],
  ["Book", "Podcast", "Movie", "Game"],
  ["Mountains", "Sea", "City", "Countryside"],
  ["Early wake-up", "Late wake-up", "Nap", "No nap"],
  ["Bus", "Metro", "Taxi", "Bicycle"],
  ["Sneakers", "Boots", "Sandals", "Slippers"],
  ["Sweet", "Salty", "Spicy", "Sour"],
  ["Series", "Movie", "Show", "Stream"],
  ["Online", "Offline", "Hybrid", "No preference"],
];

function makeOptions(values: string[]): string {
  return JSON.stringify(values.map((text, index) => ({ id: String.fromCharCode(65 + index), text })));
}

async function seedQuestions(): Promise<void> {
  const ruRows: Array<{ id: string; text: string; optionsJson: string }> = [];
  const enRows: Array<{ id: string; text: string; optionsJson: string }> = [];

  let ruId = 1;
  for (const subject of ruSubjects) {
    for (const action of ruActions) {
      const options = ruOptions[(ruId - 1) % ruOptions.length];
      ruRows.push({
        id: `q_ru_${ruId}`,
        text: `Что большинство ${subject} ${action}?`,
        optionsJson: makeOptions(options),
      });
      ruId += 1;
      if (ruRows.length >= 220) break;
    }
    if (ruRows.length >= 220) break;
  }

  let enId = 1;
  for (const subject of enSubjects) {
    for (const action of enActions) {
      const options = enOptions[(enId - 1) % enOptions.length];
      enRows.push({
        id: `q_en_${enId}`,
        text: `What will the majority ${subject} ${action}?`,
        optionsJson: makeOptions(options),
      });
      enId += 1;
      if (enRows.length >= 220) break;
    }
    if (enRows.length >= 220) break;
  }

  await prisma.question.deleteMany();
  await prisma.question.createMany({
    data: [
      ...ruRows.map((row) => ({
        id: row.id,
        lang: "ru",
        text: row.text,
        optionsJson: row.optionsJson,
        tags: "general,majority",
        weight: 1,
        isActive: true,
      })),
      ...enRows.map((row) => ({
        id: row.id,
        lang: "en",
        text: row.text,
        optionsJson: row.optionsJson,
        tags: "general,majority",
        weight: 1,
        isActive: true,
      })),
    ],
  });
}

async function seedPublicPools(): Promise<void> {
  const poolId = "public_global";
  await prisma.pool.upsert({
    where: { poolId },
    update: {},
    create: {
      poolId,
      scope: "public",
      stakeNanotons: "0",
      status: "idle",
    },
  });
}

async function main(): Promise<void> {
  await seedQuestions();
  await seedPublicPools();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed completed");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });


