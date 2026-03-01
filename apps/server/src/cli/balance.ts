import { nanoToTon } from "@arena/shared";
import { prisma } from "../db.js";

const formatTon = (nano: string) => nanoToTon(BigInt(nano));

const main = async () => {
  const tgUserId = process.argv[2];
  if (!tgUserId) {
    console.error("Usage: pnpm balance <tg_user_id>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { tgUserId },
    include: {
      balance: true,
      deposits: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!user) {
    console.error(`User not found: ${tgUserId}`);
    process.exit(1);
  }

  const balance = user.balance;
  const availableNano = balance?.availableNanotons ?? "0";
  const lockedNano = balance?.lockedNanotons ?? "0";
  const totalNano = (BigInt(availableNano) + BigInt(lockedNano)).toString();

  console.log("TG User ID:", user.tgUserId);
  console.log("Username:", user.username ?? "-");
  console.log("Available (TON):", formatTon(availableNano));
  console.log("Locked (TON):", formatTon(lockedNano));
  console.log("Total (TON):", formatTon(totalNano));
  console.log("Рекомендуем к выдаче (TON):", formatTon(availableNano));

  console.log("\nПоследние депозиты:");
  if (user.deposits.length === 0) {
    console.log("  нет");
  } else {
    for (const d of user.deposits) {
      const amount = d.amountNanotons ? formatTon(d.amountNanotons) : "-";
      console.log(
        `  ${d.depositId} | ${d.status} | ${amount} TON | ${d.createdAt.toISOString()}`
      );
    }
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
