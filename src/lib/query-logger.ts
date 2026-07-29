import prisma from "@/db/client";
import { QueryLog } from "@/core/types";

export const logQuery = async (queryData: QueryLog): Promise<void> => {
  try {
    await prisma.queryLog.create({
      data: queryData,
    });
  } catch (error) {
    console.error("Error logging query:", error);
  }
};
