// TASK-085: helpers used by more than one tool group or by the registry tail. Moved verbatim.
import { z } from "zod";

export const emptyObject = z.object({}).strict();

export const projectIdArgs = z.object({ projectId: z.string().uuid() }).strict();
